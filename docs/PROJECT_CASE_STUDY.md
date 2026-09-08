# AWUN project case study

[Project overview](../README.md) · [Русская версия](PROJECT_CASE_STUDY.ru.md) · [Architecture](ARCHITECTURE.md) · [Roadmap](../ROADMAP.md)

This case study documents the product and the development process. It is not an admissions essay and does not contain invented testimonials, audience figures or pilot results.

## The problem

Music discovery is fragmented across providers, regions, languages and scripts. A useful application must continue to produce results when one source is slow, refresh temporary playback links and preserve the listener's library without requiring another account.

AWUN was designed as one interface for multi-source search, a persistent local library and resilient playback. One early constraint shaped the architecture: the Windows application had to work without requiring the owner to operate a private paid server.

## What was shipped

- A Windows shell that starts an embedded Python and FastAPI backend on an ephemeral loopback port. A configured remote API is used only for an individual provider that fails locally.
- Progressive search results that appear as independent providers finish, with cancellation, bounded deadlines and partial-failure handling.
- A persistent manual queue with play-next, append, removal and reordering.
- My Wave, which uses bounded on-device preference signals to refill a continuous queue.
- Refresh of temporary saved playback URLs before use, followed by high-confidence cross-source recovery when the original provider fails.
- Official visible YouTube playback and explicit download capability rules for every result.
- Source health diagnostics, redacted runtime reports, local backup, validated restore and library import.
- Reproducible Windows, Android and iOS build workflows, plus a versioned Windows Release with SHA-256 files.

## Three engineering investigations

### Provider status was hidden by a UI exception

A diagnostic report marked the API unavailable with `Cannot set properties of null (setting 'textContent')` even while provider requests continued to work. The failure was in the interface update path, not in the API.

The diagnostic model was separated into API state, frontend errors and provider-specific playback failures. The result can be inspected in `frontend/app.js` and `backend/reliability/source_health.py`.

### Tests passed while the player layout still broke

String-level CSS checks did not prove which rule the browser applied. Legacy selectors with `!important` won because of cascade-layer ordering, restoring hidden controls and moving volume onto an extra row.

The conflicting priorities were corrected. Browser behavior, screenshot comparison and element-bound checks now cover 1920, 1280, 1000 and 390 pixel widths in dark and light themes. The relevant implementation and tests live in `frontend/design-system.css`, `frontend/redesign.css`, `tests/e2e/awun.spec.js` and `tests/e2e/responsiveness.spec.js`.

### A restore operation could damage the library it was meant to protect

The original import path validated the JSON envelope but accepted incompatible schema versions and invalid values. Restore now validates the complete backup before changing local state, displays the incoming track count and requires confirmation. If storage fails after a partial write, AWUN rolls back to the previous state.

The verified cases include an incompatible version, malformed JSON, invalid track data, cancellation and a simulated storage failure. The implementation is in `frontend/storage.js`; coverage is in `tests/test_frontend_runtime.py` and `tests/e2e/awun.spec.js`.

## Ownership and assisted development

The project owner defined requirements, selected the visual direction, prioritized reliability work, reviewed Windows builds and supplied screenshots and diagnostic reports from failed flows. He rejected non-functional and decorative interface elements and decided the order of product improvements.

Codex assisted with implementation, root-cause analysis, automated tests, documentation and packaging. Describing the entire codebase as written without assistance would be inaccurate. The owner's attributable work is product direction, constraint setting, acceptance decisions, hands-on verification and the decision trail visible in the repository history.

## Verifiable evidence

| Claim | Public evidence |
| --- | --- |
| Installable Windows release | [`v1.10.4`](https://github.com/Loro66/AWUN/releases/tag/v1.10.4) with installer, portable EXE and SHA-256 files |
| Python release gate | [Windows workflow run](https://github.com/Loro66/AWUN/actions/runs/34261419370), including 233 tests before packaging |
| Browser behavior and responsive layout | [Frontend workflow run](https://github.com/Loro66/AWUN/actions/runs/34261419408), covering 26 Playwright scenarios |
| Architecture and failure model | [`ARCHITECTURE.md`](ARCHITECTURE.md) and the corresponding backend, frontend and test modules |
| Development decisions | [Pull request 22](https://github.com/Loro66/AWUN/pull/22) and the [`main` history](https://github.com/Loro66/AWUN/commits/main) |

The browser suite uses controlled provider responses. It proves AWUN's behavior under modeled success, delay and failure; it does not prove that every track is available in every country. AWUN is not a VPN and does not guarantee the removal of regional restrictions.

## Evidence that does not exist yet

There are no confirmed measurements of audience size, retention, time saved or community impact. Saying that the product was intended for friends does not mean a structured pilot has already happened.

The next validation step is deliberately small: ask three consenting participants to find a recording, build a queue, reopen the application and export the library. Record task completion, time and observed problems, preserve only feedback the participant allowed to be stored, and link resulting fixes to repository issues. This is a test plan, not a claimed result.

Continue with the [product roadmap](../ROADMAP.md) or the [testing strategy](TESTING.md).
