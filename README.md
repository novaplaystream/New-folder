# Text/Image to Video (API-powered)

A simple web app that turns text or an image into a video, and text into an image, by calling any external generation API. Designed for low-end PCs: all heavy work happens on the API side.

## Features
- Text to video, image to video, or text to image
- Works with any provider via a JSON template
- Optional polling for async providers
- Railway-ready

## Local setup
1. Install dependencies:
   - `npm install`
2. Copy env:
   - `Copy-Item .env.example .env`
3. Fill `.env` with your provider details.
4. Run:
   - `npm run dev`

App: `http://localhost:3000`

## Railway deploy
1. Push to GitHub.
2. Create a new Railway project from GitHub repo.
3. Set environment variables from `.env` in Railway.
4. Deploy.

## Provider configuration
You can plug any API that accepts JSON. The server will create a payload from `VIDEO_API_BODY_TEMPLATE`.

Example template:
```json
{"prompt":"{{prompt}}","image":"{{image_data_url}}"}
```

If your provider is async, set polling variables:
- `VIDEO_API_POLL_URL_TEMPLATE` (use `{{id}}` placeholder)
- `VIDEO_API_JOB_ID_PATH`
- `VIDEO_API_POLL_DONE_PATH`
- `VIDEO_API_POLL_DONE_VALUE`
- `VIDEO_API_RESPONSE_VIDEO_URL_PATH`
- `VIDEO_API_RESPONSE_IMAGE_URL_PATH`

## Notes
- Image upload is sent as base64 in the JSON template.
- Keep file size under 10 MB by default.
