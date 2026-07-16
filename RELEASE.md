# AWUN release deployment

## 1. Deploy the Python API

The repository includes both `Dockerfile` and `render.yaml`. On Render, create a
Blueprint from the repository. Render generates `AWUN_MEDIA_SECRET`
automatically. Add these environment variables with real provider values:

```text
AWUN_YOUTUBE_API_KEY
AWUN_SOUNDCLOUD_CLIENT_ID
AWUN_SOUNDCLOUD_CLIENT_SECRET
AWUN_JAMENDO_CLIENT_ID
AWUN_GENIUS_ACCESS_TOKEN
```

Jamendo is optional and is activated only when its client ID is present. Audius
search is enabled by default; `AWUN_AUDIUS_API_KEY` may be added for a registered
Audius application.
The Genius token is optional: LRCLIB lyrics and private on-device line notes
continue to work without it.

MusicBrainz and Internet Archive need no secret. Keep
`AWUN_MUSICBRAINZ_CONTACT` set to the public project URL or a monitored contact
address. The included Render configuration enables six query variants and up
to eight Internet Archive items per provider query. It also enables at most two
YouTube Search API pages so the 100-result UI option remains bounded.

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
- SoundCloud, Audius, Jamendo and Internet Archive audio use the signed `/api/v1/media/`
  route; YouTube uses its official embedded player.
- Region controls cover AUTO, CIS, EUROPE, USA, LATAM, ASIA and GLOBAL.
- `/health` reports MusicBrainz enrichment and Internet Archive availability.
- Search responses include canonical/local/release/ISRC query variants.
- The result selector requests 30, 60 or 100 balanced results.
- Yandex CSV/JSON/M3U/TXT import stays local until an imported track is matched.
- Apple Music, Spotify and Yandex Music buttons open official catalog searches and never
  masquerade as downloadable or proxied audio.
- Starting a track returns HTTP 200 or 206.
- Seeking sends a Range request and playback resumes from the selected point.
- Saved tracks reappear after a page reload.
- The player progress line supports click/drag seeking on desktop and mobile.
- Disabled providers are visibly marked `NOT CONNECTED` and are not sent in a
  search request.
- Opening `/?q=artist%20track` runs a shareable search.
- The header renders `/static/awun-mark.svg` and remains crisp at mobile and desktop sizes.
- Switching **INTERFACE → MINIMAL** removes telemetry and source chrome while keeping search, results and playback usable.
- Clicking a result opens a Track Story without starting or interrupting playback.
- A known LRCLIB song displays plain or synced lyrics from `/api/v1/track-details`.
- A timed lyric line seeks the active player; a lyric line opens its annotations and notes.
- With `AWUN_GENIUS_ACCESS_TOKEN`, `/health` reports Genius annotations as connected.
- Added lyric notes survive reload on the same device and can be deleted.

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
