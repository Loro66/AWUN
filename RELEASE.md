# AWUN release deployment

## 1. Deploy the Python API

The repository includes both `Dockerfile` and `render.yaml`. On Render, create a
Blueprint from the repository. Render generates `AWUN_MEDIA_SECRET`
automatically. Add these environment variables with real provider values:

```text
AWUN_YOUTUBE_API_KEY
AWUN_SOUNDCLOUD_CLIENT_ID
AWUN_SOUNDCLOUD_CLIENT_SECRET
AWUN_VK_ACCESS_TOKEN
```

The VK token remains optional and works only when the VK application has audio
API access.

The deployed service is ready when this endpoint returns JSON:

```text
https://YOUR-AWUN-API/health
```

## 2. Open the web app

The Docker image serves the web interface and API from the same Render domain.
Open `https://YOUR-AWUN-API/` after deployment.

## 3. Release checks

- `/health` reports every configured provider.
- A search returns only real provider results.
- SoundCloud and VK audio uses the signed `/api/v1/media/` route; YouTube uses
  its official embedded player.
- Starting a track returns HTTP 200 or 206.
- Seeking sends a Range request and playback resumes from the selected point.
- Saved tracks reappear after a page reload.

Provider media links are short-lived. AWUN signs them for immediate playback;
users should run a fresh search when an older saved link expires.
