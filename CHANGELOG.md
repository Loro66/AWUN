# Changelog

All notable user-visible changes are documented here. SONGVALE follows semantic versioning through the root `VERSION` file.

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
