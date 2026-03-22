import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/providers", (_req, res) => {
  const list = getProviderList();
  const providers = list.map((key) => ({
    key,
    name: getProviderName(key)
  }));
  res.json({ providers });
});

app.post("/api/generate", upload.single("image"), async (req, res) => {
  try {
    const prompt = String(req.body.prompt || "").trim();
    const mode = String(req.body.mode || (req.file ? "image" : "text")).trim();
    const requestedProvider = String(req.body.provider || "auto").trim();

    if (!prompt && !req.file) {
      return res.status(400).json({ error: "Prompt or image is required." });
    }

    const list = getProviderList();
    const providerKeys = requestedProvider === "auto" ? list : [requestedProvider];
    const errors = [];

    for (const key of providerKeys) {
      try {
        const result = await runProvider({ key, mode, prompt, file: req.file });
        return res.json({ ...result, provider: getProviderName(key) });
      } catch (err) {
        const info = normalizeProviderError(err);
        errors.push({ provider: getProviderName(key), ...info });
        if (!info.retryable) {
          return res.status(info.status || 502).json({
            error: info.message || "Provider error",
            detail: info.detail,
            provider: getProviderName(key)
          });
        }
      }
    }

    return res.status(502).json({
      error: "All providers failed",
      detail: errors
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

async function runProvider({ key, mode, prompt, file }) {
  if (key === "mock") {
    if (mode === "text-image") {
      const imageUrl = getEnv("MOCK", "IMAGE_URL");
      if (!imageUrl) throw createError(500, "MOCK_IMAGE_URL is not set.");
      return { imageUrl };
    }
    const videoUrl = getEnv("MOCK", "VIDEO_URL");
    if (!videoUrl) throw createError(500, "MOCK_VIDEO_URL is not set.");
    return { videoUrl };
  }

  const apiUrl = getEnv(key, "API_URL");
  if (!apiUrl) {
    throw createError(500, `Missing API_URL for provider ${key}`);
  }

  const apiMethod = String(getEnv(key, "API_METHOD") || "POST").toUpperCase();
  const headers = buildHeaders(key);

  const imageBase64 = file ? file.buffer.toString("base64") : "";
  const imageMime = file ? file.mimetype : "";
  const imageDataUrl = file ? `data:${imageMime};base64,${imageBase64}` : "";

  const template = getEnv(key, "API_BODY_TEMPLATE") || "{}";
  const payload = buildPayload(template, {
    prompt,
    mode,
    image_base64: imageBase64,
    image_mime: imageMime,
    image_data_url: imageDataUrl
  });

  const startResponse = await fetch(apiUrl, {
    method: apiMethod,
    headers,
    body: JSON.stringify(payload)
  });

  const startText = await startResponse.text();
  if (!startResponse.ok) {
    throw createHttpError(startResponse.status, startText);
  }

  const startJson = safeJson(startText);

  const pollUrlTemplate = getEnv(key, "API_POLL_URL_TEMPLATE") || "";
  if (pollUrlTemplate) {
    const jobIdPath = getEnv(key, "API_JOB_ID_PATH") || "id";
    const jobId = getByPath(startJson, jobIdPath);
    if (!jobId) {
      throw createError(502, "Job id not found", { jobIdPath, startJson });
    }

    const pollUrl = pollUrlTemplate.replace("{{id}}", encodeURIComponent(String(jobId)));
    const maxTries = Number(getEnv(key, "API_POLL_MAX_TRIES") || 60);
    const intervalMs = Number(getEnv(key, "API_POLL_INTERVAL_MS") || 2000);
    const donePath = getEnv(key, "API_POLL_DONE_PATH") || "status";
    const doneValue = getEnv(key, "API_POLL_DONE_VALUE") || "succeeded";
    const videoUrlPath = getEnv(key, "API_RESPONSE_VIDEO_URL_PATH") || "videoUrl";
    const imageUrlPath = getEnv(key, "API_RESPONSE_IMAGE_URL_PATH") || "imageUrl";

    for (let i = 0; i < maxTries; i += 1) {
      await sleep(intervalMs);
      const pollResp = await fetch(pollUrl, { headers });
      const pollText = await pollResp.text();
      if (!pollResp.ok) {
        throw createHttpError(pollResp.status, pollText);
      }

      const pollJson = safeJson(pollText);
      const status = getByPath(pollJson, donePath);
      if (String(status) === String(doneValue)) {
        if (mode === "text-image") {
          const imageUrl = getByPath(pollJson, imageUrlPath);
          if (imageUrl) return { imageUrl };
        } else {
          const videoUrl = getByPath(pollJson, videoUrlPath);
          if (videoUrl) return { videoUrl };
        }
      }
    }

    throw createError(504, "Timeout waiting for media");
  }

  const videoUrlPath = getEnv(key, "API_RESPONSE_VIDEO_URL_PATH") || "videoUrl";
  const imageUrlPath = getEnv(key, "API_RESPONSE_IMAGE_URL_PATH") || "imageUrl";

  if (mode === "text-image") {
    const directImageUrl = getByPath(startJson, imageUrlPath);
    if (!directImageUrl) {
      throw createError(502, "Image URL not found", { imageUrlPath, startJson });
    }
    return { imageUrl: directImageUrl };
  }

  const directVideoUrl = getByPath(startJson, videoUrlPath);
  if (!directVideoUrl) {
    throw createError(502, "Video URL not found", { videoUrlPath, startJson });
  }
  return { videoUrl: directVideoUrl };
}

function getProviderList() {
  const raw = String(process.env.PROVIDERS || "custom").trim();
  const list = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? list : ["custom"];
}

function getProviderName(key) {
  if (key === "custom") return "Custom";
  if (key === "mock") return "Mock";
  return getEnv(key, "NAME") || key;
}

function getEnv(prefix, key) {
  if (!prefix || prefix === "custom") return process.env[key] || "";
  const prefixed = `PROVIDER_${prefix.toUpperCase()}_${key}`;
  return process.env[prefixed] || "";
}

function buildHeaders(prefix) {
  const headersJson = getEnv(prefix, "API_HEADERS_JSON") || "{}";
  const headers = safeJson(headersJson, {});

  if (!headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const apiKey = getEnv(prefix, "API_KEY");
  const authHeader = getEnv(prefix, "API_AUTH_HEADER") || "Authorization";
  const authPrefix = getEnv(prefix, "API_AUTH_PREFIX") || "Bearer";
  if (apiKey && !headers[authHeader]) {
    headers[authHeader] = `${authPrefix} ${apiKey}`.trim();
  }

  return headers;
}

function buildPayload(template, data) {
  const filled = template
    .replaceAll("{{prompt}}", escapeJsonValue(data.prompt || ""))
    .replaceAll("{{mode}}", escapeJsonValue(data.mode || ""))
    .replaceAll("{{image_base64}}", escapeJsonValue(data.image_base64 || ""))
    .replaceAll("{{image_mime}}", escapeJsonValue(data.image_mime || ""))
    .replaceAll("{{image_data_url}}", escapeJsonValue(data.image_data_url || ""));

  const obj = safeJson(filled, {});
  return pruneEmpty(obj);
}

function escapeJsonValue(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', "\\\"");
}

function safeJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function pruneEmpty(obj) {
  if (Array.isArray(obj)) {
    return obj
      .map(pruneEmpty)
      .filter((item) => item !== null && item !== "" && item !== undefined);
  }
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleaned = pruneEmpty(value);
      if (cleaned === null || cleaned === "" || cleaned === undefined) continue;
      out[key] = cleaned;
    }
    return out;
  }
  return obj;
}

function getByPath(obj, pathStr) {
  if (!obj || !pathStr) return undefined;
  const parts = String(pathStr)
    .replaceAll("[", ".")
    .replaceAll("]", "")
    .split(".")
    .filter(Boolean);
  let cur = obj;
  for (const part of parts) {
    if (cur && Object.prototype.hasOwnProperty.call(cur, part)) {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createHttpError(status, bodyText) {
  const detail = safeJson(bodyText, bodyText);
  const retryable = status === 402 || status === 429 || status >= 500;
  return { status, message: "Upstream request failed", detail, retryable };
}

function createError(status, message, detail = null) {
  return { status, message, detail, retryable: false };
}

function normalizeProviderError(err) {
  if (err && typeof err === "object") {
    return {
      status: err.status,
      message: err.message,
      detail: err.detail,
      retryable: Boolean(err.retryable)
    };
  }
  return { status: 500, message: String(err), detail: null, retryable: false };
}
