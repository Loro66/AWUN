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
AWUN_JAMENDO_CLIENT_ID
```

The VK token remains optional and works only when the VK application has audio
API access. Jamendo is optional and is activated only when its client ID is
present. Audius search is enabled by default; `AWUN_AUDIUS_API_KEY` may be added
for a registered Audius application.

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
- SoundCloud, VK, Audius and Jamendo audio use the signed `/api/v1/media/`
  route; YouTube uses its official embedded player.
- Starting a track returns HTTP 200 or 206.
- Seeking sends a Range request and playback resumes from the selected point.
- Saved tracks reappear after a page reload.
- The player progress line supports click/drag seeking on desktop and mobile.
- Disabled providers are visibly marked `NOT CONNECTED` and are not sent in a
  search request.
- Opening `/?q=artist%20track` runs a shareable search.

Provider media links are short-lived. AWUN signs them for immediate playback;
users should run a fresh search when an older saved link expires.

## 4. Build the Windows application

Open **GitHub → Actions → Windows desktop build → Run workflow**. The completed
run contains an `AWUN-Windows-x64` artifact with `AWUN.exe` and
`AWUN.exe.sha256`. A `v*` tag publishes both files in GitHub Releases.

The binary is not code-signed yet. Treat code signing as a release requirement
before broad public distribution.

## 5. Updating the existing Loro66/AWUN Render service

The Render service uses `awun` as its root directory. Upload release files into
`/awun`, never `/awun/awun`. A correct release contains
`/awun/AWUN-RELEASE.txt`, `/awun/backend`, `/awun/frontend` and
`/awun/Dockerfile`. After the GitHub commit, choose **Manual Deploy → Deploy
latest commit** in Render if auto-deploy does not start.
