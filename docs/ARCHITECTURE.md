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
| My Wave and smart playlists | `frontend/flow.js`, `frontend/wave-profile.js` and `frontend/smart-playlists.js` |
| Ratings and preference collection rules | `frontend/preferences.js` and `frontend/preferences-ui.js` |
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

## Preference collections and continuous discovery

The preference engine normalizes recording identity by artist and full title,
retaining live/remix/version words, and keys ratings by that identity across
sources. Each owner has a local profile in `awun-preferences-v1`. Five optional
1–5 dimensions form a weighted mean over the rated, enabled dimensions only.
Collections are derived views of favorites plus named-playlist tracks; rules
can overlap and never move/delete the underlying music.

Inventory is cached by immutable library/playlist array references. Listening
metadata is parsed only when the stored string/owner changes. Smart selections
are cached by inventory, metadata and minute; preference selections by inventory
and profile revision. Filter text is indexed per track in a WeakMap and input
renders are debounced by 100ms. Tabs retain their DOM nodes until their displayed
contents change, preserving keyboard focus.

Wave scores each candidate once, then spaces artists across batch boundaries.
It rotates queries derived from rated tracks, listening signals, the seed
collection and newly discovered artists. A single generation-checked,
cancelable batch has a 12-second deadline and at most eight attempts. Recent
recordings (1500), queued tracks (80), results (160), progress entries (128),
signals (800) and discovery seeds (24) are bounded. Exhaustion/network failures
stop automatic requests and expose retry. Repeats can return after the recent
identity window expires; the system does not promise an infinite catalog.

Wave feedback now uses owner-scoped `awun-wave-profile-v3` storage. Legacy
unowned signals are retained as guest history. Playback-position events describe
seeking; qualified listening/completion events come from accumulated playing time.
See the [2026-10-20 audit](AUDIT-2026-10-20.md) for the security boundaries and regressions.
