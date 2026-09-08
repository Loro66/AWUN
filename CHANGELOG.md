# Changelog

All notable user-visible changes are documented here. AWUN follows semantic versioning through the root `VERSION` file.

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
