const form = document.getElementById("genForm");
const statusEl = document.getElementById("status");
const videoEl = document.getElementById("video");
const imageEl = document.getElementById("imageResult");

function showMedia(type, url) {
  videoEl.style.display = "none";
  imageEl.style.display = "none";
  videoEl.removeAttribute("src");
  imageEl.removeAttribute("src");

  if (type === "image") {
    imageEl.src = url;
    imageEl.style.display = "block";
  } else {
    videoEl.src = url;
    videoEl.style.display = "block";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "Starting generation...";
  showMedia("none", "");

  const formData = new FormData(form);

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      body: formData
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Request failed");
    }

    if (data.imageUrl) {
      showMedia("image", data.imageUrl);
      statusEl.textContent = "Done (image).";
      return;
    }

    if (data.videoUrl) {
      showMedia("video", data.videoUrl);
      statusEl.textContent = "Done (video).";
      return;
    }

    throw new Error("No media URL returned by provider");
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
});
