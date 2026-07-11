# AWUN release deployment

## 1. Deploy the Python API

The repository includes both `Dockerfile` and `render.yaml`. On Render, create a
Blueprint from the repository. Render generates `AWUN_MEDIA_SECRET`
automatically. Add `AWUN_VK_ACCESS_TOKEN` only when the VK application has audio
API access.

The deployed service is ready when this endpoint returns JSON:

```text
https://YOUR-AWUN-API/health
```

## 2. Connect the web app

Set the Site runtime environment variable below to the API origin, without a
trailing slash:

```text
AWUN_API_URL=https://YOUR-AWUN-API
```

Then deploy the current Site version. The web app calls the API only through its
same-origin `/api/search` gateway.

## 3. Release checks

- `/health` reports at least YouTube and SoundCloud.
- A search returns only real provider results.
- Every returned `stream_url` uses the signed `/api/v1/media/` route.
- Starting a track returns HTTP 200 or 206.
- Seeking sends a Range request and playback resumes from the selected point.
- Saved tracks reappear after a page reload.

Provider media links are short-lived. AWUN signs them for immediate playback;
users should run a fresh search when an older saved link expires.

