# AWUN

AWUN is a FastAPI music-search aggregator with a responsive web interface. It
uses the official YouTube Data API and embedded player, the SoundCloud API when
OAuth credentials are configured, and optionally the VK API.

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
`AWUN_YOUTUBE_API_KEY`, the two SoundCloud credentials, and optionally
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

Copy `.env.example` to `.env`. YouTube is enabled only when
`AWUN_YOUTUBE_API_KEY` is set. SoundCloud uses OAuth when
`AWUN_SOUNDCLOUD_CLIENT_ID` and `AWUN_SOUNDCLOUD_CLIENT_SECRET` are set, with a
limited legacy fallback otherwise. VK is added only when
`AWUN_VK_ACCESS_TOKEN` is set.

Direct media URLs are provider-issued and normally expire. Clients should search again instead of storing them. Some providers may require their usual request headers, authentication, or region access. Use AWUN only for media you are authorized to access and in accordance with each provider's terms.

## Windows desktop app

Run `build-windows.bat` on Windows 10 or 11 to create `dist\\AWUN.exe`. The
desktop shell opens the hosted AWUN beta in its own application window. A
manual GitHub Actions workflow is also included for repeatable Windows builds.
