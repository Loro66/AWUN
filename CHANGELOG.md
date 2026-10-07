# Changelog

All notable user-visible changes are documented here. SONGVALE follows semantic versioning through the root `VERSION` file.

## [2.5.15] - 2026-10-07

### Fixed

- Resuming a library transfer preserves manual review, missing tracks, failed searches and cumulative progress. Retrying failures preserves unfinished tracks and replaces earlier results without counting them twice.
- Transfer queues remain available after reload and after subsequent retry/resume operations.
- The volume button uses a recognizable speaker with sound waves or a mute mark. Its label and tooltip reflect the current state in both interface languages; unmuting restores the previous volume, including after moving the slider to zero.

### Testing

- Added browser regressions for mixed import queues across resume, retry, manual selection and reload, and for volume controls in direct audio and YouTube playback.

## [2.5.14] - 2026-10-07

### Fixed

- Library transfer queries sources independently and allows a response within the backend's search budget. A slow SoundCloud request no longer discards an already available YouTube match.
- YouTube's public metadata search preserves the requested artist/title instead of appending words that excluded catalog tracks such as Locked23's «Я что-то посмотрел».
- Matching recognizes artist prefixes, Topic channels and French official-video labels such as Indila's «Dernière Danse (Clip Officiel)», while retaining alternate-version checks.
- Provider failures appear as unchecked tracks with retry controls and source errors in the export report. They are no longer counted as missing recordings.
- Manual review waits until automatic processing ends; it cannot change a running transfer to «Complete». Interrupted transfers restore their stopped status.
- Repeated artist/title entries appear only once in manual review, including restored queues; alternate versions remain separate.
- SoundCloud links refresh before their actual CDN expiry, including tracks found earlier in the same tab. Refresh bypasses the provider cache instead of returning the expired URL again.
- The player distinguishes direct audio from HLS, preserves the transport in playlists and permits the bundled HLS worker to run.

### Testing

- Regression cases use metadata from the reported Yandex transfer, a response past the old 14-second deadline, provider failures with retry after reload, and manual review during an unfinished transfer.
- Playback checks cover expired SoundCloud links in an active session, fresh provider lookup, and direct audio without HLS.

## [2.5.13] - 2026-10-04

### Fixed

- Importing a public playlist counts unique songs toward the track limit. Repeated entries no longer crowd out later music; missing links and cover art can be filled from a duplicate.

### Testing

- Covered 120 duplicate entries before the next song and ran the full Python suite.

## [2.5.12] - 2026-10-04

### Improved

- Replaced the generic V with a forest silhouette over a winding orange river and a custom angular SONGVALE wordmark, based on the supplied reference. The tiny tagline is gone.
- Applied the same mark to the website, PWA, Windows executable, iPhone and Android icons, and Play Store artwork.

### Testing

- Checked the mark in desktop and phone headers, icon sizes, and both themes.

## [2.5.11] - 2026-10-03

### Fixed

- Importing a library file cannot replace an account-linked library, even when the account service is offline. Combining the file preserves existing tracks.
- Restoring a full backup only offers combining with the cloud or keeping the cloud copy. Cloud-only tracks are preserved across failed writes and retries.

### Testing

- Browser checks cover a signed-in account, an offline account, full backup recovery, and retry after a failed merge.

## [2.5.10] - 2026-10-03

### Improved

- The sidebar has a clear valley mark beside the SONGVALE wordmark, with the tiny tagline removed. The mark stays readable in dark and light themes and on narrow phones.
- Updated the web app icon, iPhone icon, Android launcher and splash icon, and Play Store icon and feature graphic to use the same mark.

### Testing

- Browser checks cover desktop, phone and narrow phone headers in both themes.

## [2.5.9] - 2026-10-03

### Improved

- The player shows which track and source are loading, when it is looking for another playable version, and when no connected source can play the track. Pressing Play after an error retries the track.
- My Wave shows each search attempt in its panel and desktop sidebar, with a visible navigation badge on desktop and mobile. Empty results, source errors and the end of the queue have separate messages and an explicit Retry button.
- After its bounded search is exhausted, My Wave stops requesting more tracks until Retry or a setting change. Changing settings cancels an older pending Wave search.

### Testing

- Browser scenarios cover delayed playback, unavailable tracks, search progress, exhausted queues, source errors, retry, settings changes and mobile layout.

## [2.5.8] - 2026-10-03

### Improved

- My Wave now sends a short mood or activity and language query first. A live check found that adding the release era to the first discovery query caused empty results after provider timeouts, while the shorter queries returned playable tracks.

## [2.5.7] - 2026-10-03

### Fixed

- Restoring a full device backup while signed in pauses cloud sync and asks whether to combine libraries, keep the cloud copy, or explicitly replace it. A failed replacement stays pending after reload rather than retrying silently.
- My Wave tries broader searches when a specific recommendation query comes back empty and waits for a connected fallback source. Discovery no longer appends all settings to the playing track title.
- When no new recommendations are available, My Wave keeps the current music playing and explains that it will try again as the queue runs low.

### Testing

- Browser coverage includes backup restore and all three cloud choices, a failed replacement, empty discovery results, and a local-only Wave queue.

## [2.5.6] - 2026-10-03

### Added

- Editable profile names for optional email accounts, with name and library counts shown in Settings.
- A portable favorites and playlists file in Settings for moving libraries between devices, including guest devices. Imports show a preview and offer combine or replace.

### Improved

- Account requests now have a deadline; failed saves retry while local edits remain available. A save that succeeded in the cloud but lost its response is recognized without a false conflict.
- Signing out in one tab clears the account view in other open tabs. Imported catalog links only open through web URLs.
- Optional null track metadata no longer blocks cloud sync or file transfer.
- The installed web app prefers a fresh page online and falls back to its cached shell when the host is slow or returns a server error.

### Testing

- Added server profile and nullable-metadata tests; browser scenarios cover profile editing, guest library transfer, retry and lost-response recovery.

## [2.5.5] - 2026-10-02

### Added

- Optional email accounts with sign-in, email confirmation, password recovery, sign-out and password-confirmed deletion when a persistent Supabase project and SMTP are configured on the hosted service.
- Favorites and named playlists sync with revision checks. First sign-in reviews guest data; conflicts offer an explicit combine or cloud-copy choice. Other-account data cannot be merged accidentally.

### Improved

- Moved language switching into Settings and freed the sidebar.
- Account sessions use HTTP-only cookies; the cloud stores track metadata without expiring stream or download URLs. The local library works during account-service interruptions.

### Testing

- Added server checks for origin isolation, account-scoped writes, stale revisions, deletion and metadata sanitization, plus browser scenarios for first-device merge, fresh-device restore, conflicts and sign-out.

## [2.5.4] - 2026-10-03

### Added

- iPhone Safari visitors see localized Add to Home Screen instructions. The installed app hides those instructions and opens with its own Home Screen icon.
- Documented the account and cross-device library sync requirements, including guest-library migration and persistent storage.

### Improved

- The installed web app opens its cached interface while the hosting service wakes or the network is temporarily unavailable. Music search and streaming continue to require internet.
- The service worker leaves API responses and media streams out of its cache and no longer removes unrelated caches during updates.

### Testing

- Added browser checks for iPhone installation guidance, standalone mode and offline shell launch.

## [2.5.3] - 2026-10-01

### Added

- Named local playlists with independent track membership, a quick library filter and playlist shortcuts on the home screen.
- Transfers from a file, text list or public URL now keep confident matches in a named playlist in the source order. Interrupted transfers and manual review continue filling that playlist.

### Improved

- Playlist membership survives removal from favorites, and refreshed playback links update the corresponding playlist entries.
- Full or unavailable local storage reports a visible error instead of pretending a favorite or playlist was saved. Playlist data is included in exported backups and validated before restore.
- Playlist creation, track menus and library filtering fit narrow screens and keep the controls available in both languages.

### Testing

- Added browser scenarios for playlist persistence, imported order, backup inclusion, storage failure and mobile controls.

## [2.5.2] - 2026-09-30

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
- Search and deep links run even while source diagnostics are delayed or unavailable; source choices persist after restart.
- The library transfer accepts Russian CSV headers and quoted fields, reports collections larger than 1000 tracks instead of silently truncating them, and updates progress in batches.
- The mobile hub uses readable labels and a larger shuffle target.
- The media proxy bounds HLS reads, rejects private DNS answers at connection time, and Docker requires a shared signing secret when configured with multiple workers.

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
