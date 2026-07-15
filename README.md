# AWUN

AWUN is a FastAPI music-search aggregator with a responsive web interface. It
searches YouTube, SoundCloud, Audius and Jamendo in parallel, then fairly
interleaves the connected catalogs. YouTube playback stays inside the official
embedded player; other full tracks use short-lived signed AWUN media routes.

The 1.3 beta interface includes source-aware search, partial-failure handling,
a local library, shareable search URLs and a unified responsive player with
custom waveform seeking, volume, previous/next controls and browser Media
Session integration. Its visual system includes Acid, Ultraviolet, Cobalt and
Ember themes, optional ambient decoration and motion controls. Visual settings
are saved locally and work across desktop and mobile layouts.

In production, provider URLs are wrapped in short-lived signed AWUN media URLs.
The media endpoint supports HTTP Range requests for full-track playback and
seeking without exposing the provider URL to the client.

## Run

Python 3.11 or newer is required.

```bash
cd awun
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn backend.api.main:app --reload
```

Open `http://127.0.0.1:8000/` for AWUN or `/docs` for API documentation.

For a hosted beta, deploy the included `Dockerfile` to any container host. A
`render.yaml` Blueprint is included for Render. Configure
`AWUN_YOUTUBE_API_KEY` (recommended), the two SoundCloud credentials, and optionally
`AWUN_JAMENDO_CLIENT_ID` in the host dashboard. Audius
read-only search works without a secret; `AWUN_AUDIUS_API_KEY` is optional.

See `RELEASE.md` for the production deployment and verification checklist.

## Search API

POST `/api/v1/search`:

```json
{
  "query": "Daft Punk Around the World",
  "limit": 100,
  "sources": ["youtube", "soundcloud", "audius", "jamendo"]
}
```

Or use GET:

```text
/api/v1/search?q=Daft%20Punk&limit=10&sources=youtube&sources=soundcloud
```

The response contains combined results sorted by quality score. An unavailable source appears in `errors`; successful sources still return results.

## Configuration

Copy `.env.example` to `.env`. YouTube uses the Data API when
`AWUN_YOUTUBE_API_KEY` is set and otherwise falls back to metadata-only
`yt-dlp` search; playback always stays in the official embedded player. SoundCloud uses OAuth when
`AWUN_SOUNDCLOUD_CLIENT_ID` and `AWUN_SOUNDCLOUD_CLIENT_SECRET` are set, with a
limited legacy fallback otherwise. Audius is enabled by default and uses its
read-only REST API. Jamendo is added only when `AWUN_JAMENDO_CLIENT_ID` is set.

Direct media URLs are provider-issued and normally expire. Clients should search again instead of storing them. Some providers may require their usual request headers, authentication, or region access. Use AWUN only for media you are authorized to access and in accordance with each provider's terms.

The web library refreshes expired non-YouTube playback URLs when possible.
AWUN exposes a download button only when the provider supplies a real,
progressive download resource. HLS/DASH playlists and DRM media are playback
resources, not files, and are never presented as downloads.
Without SoundCloud OAuth credentials, AWUN deliberately limits the fallback to
five results per query for reliability; configure OAuth for the full range.

## Windows desktop app

Run `build-windows.bat` on Windows 10 or 11 to create `dist\\AWUN.exe` and its
SHA256 checksum. The desktop shell shows an AWUN wake-up screen while Render
starts, then opens the hosted beta in its own application window.

For a reproducible cloud build, open **Actions → Windows desktop build → Run
workflow**. Every pull request also creates an `AWUN-Windows-x64` test artifact.
Download it from the completed run. Pushing a tag such as `v1.3.0` creates a
GitHub Release containing the executable and
checksum. The executable is currently unsigned, so Windows SmartScreen may
show a warning until a code-signing certificate is added.

## Android and iOS beta apps

The native mobile shells live in `mobile/android` and `mobile/ios`. Open a pull
request or run **Actions → Mobile beta builds** to create an installable Android
APK, an unsigned iOS IPA and an iOS Simulator archive. See `mobile/README.md`
for installation and signing details. A physical-device iOS release requires
Apple signing credentials; the repository never stores those secrets.
