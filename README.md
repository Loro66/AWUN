# AWUN

AWUN is a FastAPI music-search aggregator with a responsive web interface. It
uses the official YouTube Data API when configured (with a metadata-only
fallback) and embedded player, the SoundCloud API when
OAuth credentials are configured, and optionally the VK API.

The 1.1 beta interface includes source-aware search, partial-failure handling,
a local library, shareable search URLs and a unified responsive player with
custom seeking, volume, previous/next controls and browser Media Session
integration. YouTube playback stays inside the official embedded player.

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
`AWUN_VK_ACCESS_TOKEN` in the host dashboard.

See `RELEASE.md` for the production deployment and verification checklist.

## Search API

POST `/api/v1/search`:

```json
{
  "query": "Daft Punk Around the World",
  "limit": 100,
  "sources": ["youtube", "soundcloud", "vk"]
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
limited legacy fallback otherwise. VK is added only when
`AWUN_VK_ACCESS_TOKEN` is set.

Direct media URLs are provider-issued and normally expire. Clients should search again instead of storing them. Some providers may require their usual request headers, authentication, or region access. Use AWUN only for media you are authorized to access and in accordance with each provider's terms.

The web library refreshes expired non-YouTube playback URLs when possible.
AWUN exposes a download button only when the provider supplies a real,
progressive download resource. HLS/DASH playlists and DRM media are playback
resources, not files, and are never presented as downloads.
Without SoundCloud OAuth credentials, AWUN deliberately limits the fallback to
five results per query for reliability; configure OAuth for the full range.

## Windows desktop app

Run `build-windows.bat` on Windows 10 or 11 to create `dist\\AWUN.exe`. The
desktop shell opens the hosted AWUN beta in its own application window. A
manual GitHub Actions workflow is also included for repeatable Windows builds.
