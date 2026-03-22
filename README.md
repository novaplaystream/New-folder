# Nova Video Lab

Premium UI demo for text-to-video, image-to-video, and text-to-image. Runs on low-end PCs by using external APIs.

## Local
1. `npm install`
2. `Copy-Item .env.example .env`
3. Fill `.env` with your provider info
4. `npm run dev`

## Railway
- Push to GitHub
- Create Railway project from repo
- Add env vars from `.env`
- Deploy

## Multi‑Provider (Auto Fallback)
Set `PROVIDERS` with comma‑separated keys. Example:
```
PROVIDERS=custom,backup1
```
Each provider uses either the default keys (custom) or prefixed keys like:
```
PROVIDER_BACKUP1_API_URL=
PROVIDER_BACKUP1_API_KEY=
```

In the UI, choose a provider or keep **Auto (Fallback)**.
Auto will switch when a provider returns 402/429 or 5xx.

## GitHub Pages (UI only)
1. Run `npm run build:docs`
2. GitHub Settings → Pages → Source: `docs/`
