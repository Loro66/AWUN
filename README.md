# AWUN

AWUN is a FastAPI music-search aggregator with a responsive web interface. It
searches YouTube, SoundCloud, Audius, Jamendo and Internet Archive in parallel,
then fairly interleaves the connected catalogs. MusicBrainz expands human
queries into canonical artist/track, local alias, release, transliteration and
ISRC variants. Yandex Music libraries can be transferred as metadata and
matched to connected playable sources on demand. YouTube playback stays inside the official embedded player;
other full tracks use short-lived signed AWUN media routes.

The 1.7 beta interface includes AUTO/CIS/EUROPE/USA/LATAM/ASIA/GLOBAL search,
source-aware discovery, partial-failure handling,
a 30/60/100 result selector, Yandex library import, a local library, shareable search URLs and a unified responsive player with
custom waveform seeking, volume, previous/next controls and browser Media
Session integration. A new geometric SVG mark stays sharp in the web, desktop
and mobile shells. Its visual system includes Acid, Ultraviolet, Cobalt and
Ember themes, Editorial and music-first Minimal layouts, plus motion controls. Visual settings
are saved locally and work across desktop and mobile layouts.

Click any result (or its **STORY** button) to open a Track Story. AWUN requests
plain or time-synced lyrics from LRCLIB on demand and, when
`AWUN_GENIUS_ACCESS_TOKEN` is configured, attaches official Genius annotations
to the closest lyric line. Each line also accepts private AWUN notes stored only
in that browser. AWUN does not scrape Genius pages and does not cache lyrics.

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
`AWUN_JAMENDO_CLIENT_ID` and `AWUN_GENIUS_ACCESS_TOKEN` in the host dashboard. Audius
read-only search works without a secret; `AWUN_AUDIUS_API_KEY` is optional.
MusicBrainz and Internet Archive work without secrets.
LRCLIB lyrics also work without a secret; the Genius token only adds annotations.

See `RELEASE.md` for the production deployment and verification checklist.

## Search API

POST `/api/v1/search`:

```json
{
  "query": "Daft Punk Around the World",
  "limit": 60,
  "sources": ["youtube", "soundcloud", "audius", "jamendo", "internet_archive"],
  "region": "GLOBAL",
  "locale": "en-US"
}
```

Or use GET:

```text
/api/v1/search?q=Daft%20Punk&limit=10&sources=youtube&sources=internet_archive&region=EUROPE&locale=de-DE
```

The response contains combined results, the applied region and `query_variants`
used for discovery. An unavailable source appears in `errors`; successful
sources still return results. Every playable result also includes official
Apple Music, Spotify and Yandex Music catalog-search links; those services are navigation
targets and are never proxied as AWUN audio.

## Discovery coverage

| Capability | What it adds | Full playback | Download |
| --- | --- | --- | --- |
| Internet Archive | Archival, independent and rare public audio | Yes | When a public media file exists |
| MusicBrainz | Aliases, scripts, ISRCs and release names | Metadata only | No |
| Apple Music / Spotify | Large region-aware catalogs via official links | On the official service | No |
| Yandex Music | Local import of library metadata and official catalog links | Imported tracks are matched to connected AWUN sources; Yandex playback stays official | No |
| Regional YouTube | Results relevant to CIS, Europe, USA, LATAM and Asia | Official YouTube player | No |

Region mode changes discovery relevance; it does not bypass provider licensing
or geographic restrictions. In AUTO mode the browser locale selects a country
and language. GLOBAL removes the YouTube country/language preference.

## Yandex Music library transfer

Click **IMPORT → YM** and upload a CSV, JSON, M3U/M3U8 or TXT file, or paste one
`Artist — Track` per line. AWUN stores only normalized track metadata in the
browser library. The first time an imported item is played, AWUN searches the
currently connected sources, selects the closest playable match and replaces
the placeholder with that live result. Every item retains an official Yandex
Music catalog link.

AWUN does not ask for a Yandex password or account token and does not call
undocumented private endpoints or extract protected Yandex media URLs. Yandex
documents its own supported inbound collection transfer at
<https://yandex.ru/support/music/ru/collection/transfer>; exporting a library
for AWUN currently requires a user-provided metadata file or pasted track list.

## Track Stories, lyrics and comments

`GET /api/v1/track-details?artist=...&title=...&duration=...` returns an ordered
list of lyric lines. When LRCLIB provides LRC timestamps, selecting a timestamp
seeks the active track to that line. Selecting the lyric itself opens its
thread: official Genius annotations appear first and the listener can add or
delete local notes beneath them.

The beta intentionally separates provider content from AWUN user data:

- lyrics are requested from <https://lrclib.net/docs> and not persisted by the API;
- Genius referents use <https://docs.genius.com/> only when a server-side token exists;
- personal line notes live in browser `localStorage` and are not public or synced.

A public multi-user comment network will require authenticated accounts,
moderation and persistent storage; it is not silently simulated in this release.

## Configuration

Copy `.env.example` to `.env`. YouTube uses the Data API when
`AWUN_YOUTUBE_API_KEY` is set and otherwise falls back to metadata-only
`yt-dlp` search; playback always stays in the official embedded player. With
an API key AWUN follows up to `AWUN_YOUTUBE_MAX_PAGES=2`, allowing as many as
100 YouTube candidates while keeping quota use bounded. SoundCloud uses OAuth when
`AWUN_SOUNDCLOUD_CLIENT_ID` and `AWUN_SOUNDCLOUD_CLIENT_SECRET` are set, with a
limited legacy fallback otherwise. Audius is enabled by default and uses its
read-only REST API. Jamendo is added only when `AWUN_JAMENDO_CLIENT_ID` is set.
Internet Archive is enabled by default and exposes only public audio files.
MusicBrainz is enabled by default; set `AWUN_MUSICBRAINZ_CONTACT` to a project
URL or contact address and adjust `AWUN_QUERY_EXPANSION_LIMIT` if needed.
LRCLIB is enabled by default. Add `AWUN_GENIUS_ACCESS_TOKEN` for Genius
referents; never expose this value to the frontend or commit it to the repository.

Direct media URLs are provider-issued and normally expire. Clients should search again instead of storing them. Some providers may require their usual request headers, authentication, or region access. Use AWUN only for media you are authorized to access and in accordance with each provider's terms.

The web library refreshes expired non-YouTube playback URLs when possible.
AWUN exposes a download button only when the provider supplies a real,
progressive download resource. HLS/DASH playlists and DRM media are playback
resources, not files, and are never presented as downloads.
Without SoundCloud OAuth credentials, AWUN deliberately limits the fallback to
five results per query for reliability; configure OAuth for the full range.

## Windows desktop app

Run `build-windows.bat` on Windows 10 or 11 to create `dist\\AWUN.exe` and its
SHA256 checksum. The AWUN icon is embedded in the executable and is used by
Explorer, shortcuts and the taskbar. The desktop shell shows an AWUN wake-up screen while Render
starts, then opens the hosted beta in its own application window.

For a reproducible cloud build, open **Actions → Windows desktop build → Run
workflow**. Every pull request also creates an `AWUN-Windows-x64` test artifact.
Download it from the completed run. Pushing a tag such as `v1.7.0` creates a
GitHub Release containing the executable and
checksum. The executable is currently unsigned, so Windows SmartScreen may
show a warning until a code-signing certificate is added.

## Android and iOS beta apps

The native mobile shells live in `mobile/android` and `mobile/ios`. Open a pull
request or run **Actions → Mobile beta builds** to create an installable Android
APK, an unsigned iOS IPA and an iOS Simulator archive. See `mobile/README.md`
for installation and signing details. A physical-device iOS release requires
Apple signing credentials; the repository never stores those secrets.
