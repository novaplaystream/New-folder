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

app.post("/api/generate", upload.single("image"), async (req, res) => {
  try {
    const prompt = String(req.body.prompt || "").trim();
    const mode = String(req.body.mode || (req.file ? "image" : "text")).trim();

    if (!prompt && !req.file) {
      return res.status(400).json({ error: "Prompt or image is required." });
    }

    const provider = String(process.env.PROVIDER || "custom").toLowerCase();

    if (provider === "mock") {
      if (mode === "text-image") {
        const imageUrl = process.env.MOCK_IMAGE_URL || "";
        if (!imageUrl) {
          return res.status(500).json({ error: "MOCK_IMAGE_URL is not set." });
        }
        return res.json({ imageUrl, provider: "mock" });
      }
      const videoUrl = process.env.MOCK_VIDEO_URL || "";
      if (!videoUrl) {
        return res.status(500).json({ error: "MOCK_VIDEO_URL is not set." });
      }
      return res.json({ videoUrl, provider: "mock" });
    }

    const apiUrl = process.env.VIDEO_API_URL;
    if (!apiUrl) {
      return res.status(500).json({
        error: "VIDEO_API_URL is not set. Configure your provider in .env"
      });
    }

    const apiMethod = String(process.env.VIDEO_API_METHOD || "POST").toUpperCase();
    const headers = buildHeaders();

    const imageBase64 = req.file ? req.file.buffer.toString("base64") : "";
    const imageMime = req.file ? req.file.mimetype : "";
    const imageDataUrl = req.file ? `data:${imageMime};base64,${imageBase64}` : "";

    const template = process.env.VIDEO_API_BODY_TEMPLATE || "{}";
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
      return res.status(502).json({
        error: "Upstream request failed",
        status: startResponse.status,
        detail: safeJson(startText)
      });
    }

    const startJson = safeJson(startText);

    const pollUrlTemplate = process.env.VIDEO_API_POLL_URL_TEMPLATE || "";
    if (pollUrlTemplate) {
      const jobIdPath = process.env.VIDEO_API_JOB_ID_PATH || "id";
      const jobId = getByPath(startJson, jobIdPath);
      if (!jobId) {
        return res.status(502).json({
          error: "Job id not found in start response",
          detail: { jobIdPath, startJson }
        });
      }

      const pollUrl = pollUrlTemplate.replace("{{id}}", encodeURIComponent(String(jobId)));
      const maxTries = Number(process.env.VIDEO_API_POLL_MAX_TRIES || 60);
      const intervalMs = Number(process.env.VIDEO_API_POLL_INTERVAL_MS || 2000);
      const donePath = process.env.VIDEO_API_POLL_DONE_PATH || "status";
      const doneValue = process.env.VIDEO_API_POLL_DONE_VALUE || "succeeded";
      const videoUrlPath = process.env.VIDEO_API_RESPONSE_VIDEO_URL_PATH || "videoUrl";
      const imageUrlPath = process.env.VIDEO_API_RESPONSE_IMAGE_URL_PATH || "imageUrl";

      for (let i = 0; i < maxTries; i += 1) {
        await sleep(intervalMs);
        const pollResp = await fetch(pollUrl, { headers });
        const pollText = await pollResp.text();
        if (!pollResp.ok) {
          return res.status(502).json({
            error: "Polling failed",
            status: pollResp.status,
            detail: safeJson(pollText)
          });
        }

        const pollJson = safeJson(pollText);
        const status = getByPath(pollJson, donePath);
        if (String(status) === String(doneValue)) {
          if (mode === "text-image") {
            const imageUrl = getByPath(pollJson, imageUrlPath);
            if (imageUrl) {
              return res.json({ imageUrl, provider: "custom" });
            }
          } else {
            const videoUrl = getByPath(pollJson, videoUrlPath);
            if (videoUrl) {
              return res.json({ videoUrl, provider: "custom" });
            }
          }
        }
      }

      return res.status(504).json({ error: "Timeout waiting for media." });
    }

    const videoUrlPath = process.env.VIDEO_API_RESPONSE_VIDEO_URL_PATH || "videoUrl";
    const imageUrlPath = process.env.VIDEO_API_RESPONSE_IMAGE_URL_PATH || "imageUrl";
    if (mode === "text-image") {
      const directImageUrl = getByPath(startJson, imageUrlPath);
      if (!directImageUrl) {
        return res.status(502).json({
          error: "Image URL not found in response",
          detail: { imageUrlPath, startJson }
        });
      }
      return res.json({ imageUrl: directImageUrl, provider: "custom" });
    }

    const directVideoUrl = getByPath(startJson, videoUrlPath);
    if (!directVideoUrl) {
      return res.status(502).json({
        error: "Video URL not found in response",
        detail: { videoUrlPath, startJson }
      });
    }

    return res.json({ videoUrl: directVideoUrl, provider: "custom" });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

function buildHeaders() {
  const headersJson = process.env.VIDEO_API_HEADERS_JSON || "{}";
  const headers = safeJson(headersJson, {});

  if (!headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const apiKey = process.env.VIDEO_API_KEY;
  const authHeader = process.env.VIDEO_API_AUTH_HEADER || "Authorization";
  const authPrefix = process.env.VIDEO_API_AUTH_PREFIX || "Bearer";
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
