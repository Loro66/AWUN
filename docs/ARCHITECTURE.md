# SongVale architecture

[Project](../README.md) · [Development](DEVELOPMENT.md) · [Testing](TESTING.md)

SongVale uses one frontend in the browser, Windows desktop shell and mobile
WebViews. The Python backend exposes the search, metadata and media APIs.

| Area | Runtime implementation |
| --- | --- |
| API and static delivery | `backend/api/main.py` |
| Optional account gateway | `backend/api/accounts.py`; Supabase setup is described in [ACCOUNTS.md](ACCOUNTS.md) |
| Search and balancing | `backend/search/engine.py` |
| Query expansion | `backend/search/enrichment.py` |
| Recording identity | `backend/search/track_identity.py` and `text_normalization.py` |
| Source adapters | `backend/sources/` |
| Cache, circuit breaking and source health | `backend/reliability/` |
| Search diagnostics | `backend/analytics/search_metrics.py` |
| Media tokens, safe URLs, DNS and headers | `backend/core/media.py` and `backend/security/` |
| Library matching | `frontend/library-matcher.js` |
| My Wave and smart playlists | `frontend/flow.js` and `frontend/smart-playlists.js` |
| Device storage and recovery | `frontend/storage.js` |
| Desktop process, controls and updates | `desktop/launcher.py`, `controls.py` and `updater.py` |

## Search and playback

The API validates the query and requested sources. The search engine expands
queries where useful, calls eligible adapters concurrently, deduplicates their
results and balances the returned catalogs. Cache entries, inflight searches,
deadlines and circuit breakers bound the work.

Saved tracks refresh expiring provider URLs before playback. The frontend may
select a close alternative after a source failure, preserving the listening
position only when title, artist and duration agree. YouTube stays in the
visible official embedded player. Direct audio and permitted HLS resources
pass through validated, short-lived signed media routes.

## Local data and platforms

Favorites, named playlists, queue, settings and taste signals live on the
device. Optional configured accounts can persist library data through the
account gateway. The default local workflow requires no account.

Windows packages the frontend and backend together. It binds the API to an
ephemeral loopback port, tries local providers first and uses the configured
owned backend for eligible provider failures. Android and iOS shells load the
owned HTTPS deployment and use a configured owned mirror if necessary.

## Styles and assets

`/design-system.css` is assembled by the backend from `styles.css`,
`forest.css` and `redesign.css` in explicit cascade layers. There is no separate
static stylesheet with that name. The service worker caches the assembled
endpoint and the application shell.

Google Play text is localized in `mobile/android/fastlane/metadata/android`.
Images shared by both locales live once in `mobile/android/fastlane/images`.
`scripts/package_play_listing.py` restores the conventional per-locale layout
in each build artifact.

Configuration and endpoints are documented in the [technical reference](TECHNICAL_REFERENCE.md).
