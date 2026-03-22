const form = document.getElementById("genForm");
const statusEl = document.getElementById("status");
const videoEl = document.getElementById("video");
const imageEl = document.getElementById("imageResult");
const emptyEl = document.getElementById("emptyState");
const progressBar = document.getElementById("progressBar");

function showMedia(type, url) {
  videoEl.style.display = "none";
  imageEl.style.display = "none";
  videoEl.removeAttribute("src");
  imageEl.removeAttribute("src");

  if (type === "image") {
    imageEl.src = url;
    imageEl.style.display = "block";
  } else if (type === "video") {
    videoEl.src = url;
    videoEl.style.display = "block";
  }
}

function setProgress(value) {
  progressBar.style.width = `${value}%`;
}

const presetButtons = document.querySelectorAll(".presets button");
presetButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const prompt = document.getElementById("prompt");
    const preset = btn.getAttribute("data-preset");
    prompt.value = preset;
    prompt.focus();
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "Starting generation...";
  emptyEl.style.display = "none";
  setProgress(10);
  showMedia("none", "");

  const formData = new FormData(form);

  try {
    setProgress(35);
    const res = await fetch("/api/generate", {
      method: "POST",
      body: formData
    });

    setProgress(70);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Request failed");
    }

    if (data.imageUrl) {
      showMedia("image", data.imageUrl);
      statusEl.textContent = "Done (image).";
      setProgress(100);
      return;
    }

    if (data.videoUrl) {
      showMedia("video", data.videoUrl);
      statusEl.textContent = "Done (video).";
      setProgress(100);
      return;
    }

    throw new Error("No media URL returned by provider");
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    setProgress(0);
    emptyEl.style.display = "block";
  }
});
