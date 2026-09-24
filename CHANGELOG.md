# Changelog

All notable user-visible changes are documented here. SONGVALE follows semantic versioning through the root `VERSION` file.

## [Unreleased]

### Added

- A home hub that adapts to the local library and listening history, with paused-session resume, library shuffle, queue access and familiar-artist searches.
- Six recent search shortcuts, persisted on the device with a clear-history action.
- Localized mood searches and useful first-visit states, without background catalog requests.

### Improved

- Compact recent-track cards keep focus and reflect loading, playing, paused and saved states without rebuilding the controls.
- The logo returns home without restarting playback; leaving search clears its URL so reloading home stays on home.
- Shuffle retains every library track, including the previously active recording.
- The home layout works from 320 px through wide desktop screens, with a compact resume card on mobile and readable light-theme player controls.
- Changing language keeps the active track title and play/pause labels correct.

### Testing

- Added home behavior, responsive layout and language-switching coverage, with desktop and mobile screenshots attached for visual review.

## [2.5.1] - 2026-09-17

### Improved

- Resolve LRCLIB fallback results by artist, canonical title and duration instead of accepting a same-title recording by another artist.
- Score Genius hits by artist, title, search rank and recording version, rejecting conflicting live, remix, cover, acoustic, instrumental, demo, remaster, slowed and sped-up variants.
- Retry an inconclusive Genius lookup with one distinctive lyric line from the confirmed LRCLIB result while keeping the same confidence gates.
- Read a bounded second page of Genius referents and attach annotations to the nearest matching lyric line.
- Clarify that full plain or synced text comes from LRCLIB and that SONGVALE does not scrape Genius lyric pages.

### Testing

- Added regression coverage for same-title artist collisions, out-of-order Genius results, recording-version conflicts and lyric-line fallback queries.
- The release gate now covers 246 Python tests, 9 frontend unit tests and 35 browser behavior/responsive scenarios.

## [2.5.0] - 2026-09-17

### Added

- Added a device-local stale-while-revalidate cache for the eight most recent searches. Repeating a query now shows results immediately while every connected source refreshes in the background.
- Added local playback-session restore for the last track and position. SONGVALE returns paused after restart and resumes only after an explicit play action.

### Improved

- Replace each cached provider group only after that source answers, so a temporarily unavailable provider does not erase useful recent results.
- Route restored playback through the normal stream-refresh and fallback path instead of attempting to reuse an expired media URL blindly.
- Keep transient search-cache data out of exported local backups and remove the playback session when the player is explicitly closed.

### Testing

- Added browser scenarios for immediate cached search results, background revalidation, paused playback restore, position recovery and explicit session removal.
- The release gate now covers 242 Python tests, 9 frontend unit tests and 35 browser behavior/responsive scenarios.

## [2.4.0] - 2026-09-17

### Added

- Added a calm manual-review queue for uncertain library matches with the three best candidates, refined search, explicit selection and skip actions.
- Added resumable transfer sessions stored locally on the device and a one-click retry for only the tracks that were not found.
- Added a deterministic 200-record anonymized matcher benchmark with correct-match, correct-rejection, false-match and not-found metrics.

### Improved

- Prevent duplicate recordings during resume and retry even when the same recording comes back from a different provider ID.
- Include tracks awaiting review and tracks still pending in the downloadable transfer report.

### Testing

- Added browser coverage for manual review, refined search, selection, skip, resume after reload, missed-only retry and duplicate prevention.
- Benchmark result: 100/100 correct matches, 100/100 correct rejections, zero false matches and zero unexpected not-found results.

## [2.3.0] - 2026-09-17

### Added

- Added SONGVALE Sound processing for direct audio streams with conservative loudness leveling, tonal profiles, soft compression and peak limiting.
- Added Neutral, Forest Warm and Clarity profiles with locally persisted settings.

### Improved

- Replaced fixed-threshold library matching with fuzzy title, artist and duration scoring.
- Ignore harmless catalog decorations such as Official Audio, punctuation differences and featured-artist suffixes.
- Retry unmatched imports with cleaned artist-title and title-only queries.
- Preserve durations from copied lists, M3U, CSV and JSON exports to distinguish recordings more accurately.

### Safety

- Reject mismatched remix, live, acoustic, instrumental, cover, speed and demo variants instead of inflating the import count with wrong recordings.

### Testing

- Added dedicated matcher unit tests and a browser regression scenario for non-exact catalog metadata.

## [2.2.0] - 2026-09-16

### Redesigned

- Rebuilt the persistent player as a compact listening dock with a clear metadata, transport, timeline and utility hierarchy.
- Reduced the oversized waveform and empty spacing while keeping the waveform as a recognizable SONGVALE element.
- Added consistent circular controls, restrained separators and responsive layouts for desktop, compact and mobile widths.

### Improved

- Keep save/remove-from-library and queue controls directly available from the player on every supported viewport.
- Hide only secondary volume and expansion tools on narrow phones so playback remains comfortable instead of cramped.

### Testing

- Updated all four reviewed visual baselines and expanded geometry checks to cover the player save control.

## [2.1.2] - 2026-09-16

### Fixed

- Group copied playlist rows into complete title-and-artist records instead of treating durations and each artist line as separate tracks.
- Ignore standalone duration metadata such as `02:40` during text import.
- Preserve multiple artist lines as one combined artist field before matching.
- Add a save or remove-from-library control directly to the persistent player panel.

### Testing

- Added a browser regression scenario for the multiline playlist format that previously turned a small library into dozens of invalid searches.

## [2.1.1] - 2026-09-16

### Redesigned

- Restored the quiet dark-forest identity with real forest photography, calmer typography and a muted natural-gold accent.
- Replaced the dashboard-like first screen with a focused invitation to transfer a library or begin searching.
- Simplified Library Transfer into a restrained editorial workspace that keeps the forest atmosphere visible.

### Removed

- Removed the waveform logo, decorative status dots, numbered badges, abstract signal diagrams and arrow-heavy call-to-action styling.
- Removed interface ornaments that looked like generated dashboard placeholders without communicating useful state.

### Distribution

- Refreshed the Windows, Android, iOS and browser icons around the quieter SONGVALE monogram.
- Updated reviewed desktop and mobile screenshots and added regression coverage for the new visual identity.

## [2.1.0] - 2026-09-15

### Redesigned

- Rebuilt the first-run screen around library transfer, local storage and the SONGVALE forest/orange identity.
- Promoted Library Transfer to the main desktop navigation and organized its inputs into public link, export file and pasted-list paths.
- Added a persistent transfer report with live totals, progress, cancellation, library access and downloadable unmatched-track details.

### Changed

- Process up to 1,000 unique tracks from local exports or pasted lists instead of silently stopping after the first 100.
- Read up to 500 entries from supported public playlist pages.
- Save confirmed matches throughout long transfers so stopping the operation keeps completed work.

### Fixed

- Reject weak imported-track matches instead of accepting the first unrelated provider result.
- Keep imported libraries and previous AWUN desktop data compatible with the SONGVALE Windows package.

### Distribution

- Publish the per-user installer, portable EXE, separate SHA-256 files, license and EULA after the release test gates pass.

## [2.0.0] - 2026-09-11

### Rebranded

- Renamed the product from AWUN to SONGVALE across the web interface, PWA, Windows launcher and installer, Android client, iOS shell, diagnostics and legal pages.
- Introduced an original five-pillar sound-valley mark, a deep forest and signal-orange palette, and a quieter geometric wordmark.
- Replaced the Windows, Android, iOS and browser icons with the new identity.

### Compatibility

- Preserved existing local-storage keys, application IDs, server URL and environment-variable prefix so upgrades retain user data and deployment configuration.
- Added desktop migration from the legacy AWUN state directory and kept legacy AWUN backup imports valid.
- Added the `SONGVALE_REMOTE_API_URL` desktop setting while retaining `AWUN_REMOTE_API_URL` as a fallback.

### Distribution

- Renamed the Windows deliverables to `SONGVALE.exe` and `SONGVALE-Setup-x64.exe`.
- Updated product metadata, store listings and release automation for SONGVALE 2.0.0.

## [1.10.6] - 2026-09-11

### Fixed

- Kept track action menus outside paint containment so their buttons remain clickable over adjacent rows.

### Distribution

- Rebuilt the Windows installer after the browser workflow reproduced and verified the menu fix.

## [1.10.5] - 2026-09-11

### Changed

- Replaced the frontend stylesheet import chain with one cached and precompressed response.
- Deferred the HLS player until a SoundCloud stream needs it and stopped idle playback polling.
- Updated queue rows in place and consolidated their controls under one delegated event handler.
- Reused fresh stream URLs for up to 20 minutes while preserving stale-link recovery.
- Ran sparse search aliases concurrently and reused precomputed track fingerprints during deduplication.

### Removed

- Removed unused status-clock code, forced layout reads and full-viewport decorative animation.
- Removed an unused 349 KB castle image and its attribution sidecar from the packaged frontend.

### Distribution

- Rebuilt the portable Windows application and per-user installer from the tested `main` branch.
- Published both Windows executables with separate SHA-256 checksums.

## [1.10.4] - 2026-09-08

### Added

- Progressive search feedback, cancellation and retry without discarding completed provider results.
- Paginated rendering for large local libraries.
- Keyboard-accessible waveform seeking.
- Browser behavior, geometry and visual checks across four responsive widths.
- Automatic GitHub Release publication after a successful Windows build.

### Changed

- Reduced duplicate startup health requests and shared identical in-flight search enrichment work.
- Applied explicit local and remote search budgets so healthy local results do not wait for a fallback server.
- Preserved focus, queue menus and editable notes while late provider results update the list.
- Unified compact controls with theme tokens and improved light-theme readability.
- Refreshed reviewed Linux screenshot baselines for the pinned Playwright runner.

### Fixed

- Prevented stale saved-link and HLS failures from stopping a newer playback choice.
- Prevented late searches from replacing the library or My Wave screen.
- Corrected player controls that could cross the dock boundary at responsive breakpoints.
- Validated backup contents before replacement and rolled back failed local restores.
- Separated frontend diagnostic errors from provider health failures.

### Distribution

- Published `AWUN.exe` and `AWUN-Setup-x64.exe` with separate SHA-256 files.
- Included the proprietary freeware license and EULA in the Windows release.
- Prepared Android Play metadata and reproducible unsigned mobile build workflows.

## Earlier development

Versions before 1.10.4 were iterative beta builds. Their exact changes remain available in the [commit history](https://github.com/Loro66/AWUN/commits/main) and pull requests.

[1.10.4]: https://github.com/Loro66/AWUN/releases/tag/v1.10.4
[1.10.5]: https://github.com/Loro66/AWUN/releases/tag/v1.10.5
[1.10.6]: https://github.com/Loro66/AWUN/releases/tag/v1.10.6
[2.0.0]: https://github.com/Loro66/AWUN/releases/tag/v2.0.0
[2.1.0]: https://github.com/Loro66/AWUN/releases/tag/v2.1.0
[2.1.1]: https://github.com/Loro66/AWUN/releases/tag/v2.1.1
[2.1.2]: https://github.com/Loro66/AWUN/releases/tag/v2.1.2
[2.3.0]: https://github.com/Loro66/AWUN/releases/tag/v2.3.0
[2.4.0]: https://github.com/Loro66/AWUN/releases/tag/v2.4.0
[2.5.0]: https://github.com/Loro66/AWUN/releases/tag/v2.5.0
[2.5.1]: https://github.com/Loro66/AWUN/releases/tag/v2.5.1
