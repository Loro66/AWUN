# AWUN testing strategy

[Project overview](../README.md) · [Case study](PROJECT_CASE_STUDY.md) · [Architecture](ARCHITECTURE.md) · [Roadmap](../ROADMAP.md) · [GitHub Actions](https://github.com/Loro66/AWUN/actions)

AWUN combines deterministic unit and integration tests with browser-level behavior, geometry and screenshot checks. The objective is to test failure handling and user-visible state, not only the presence of implementation strings.

## Verified scope for v1.10.4

| Layer | Current verified count | Examples |
| --- | ---: | --- |
| Python tests | 233 | Search, source adapters, matching, ranking, policy, media security, reliability and desktop packaging |
| Playwright scenarios | 26 | Progressive results, cancellation, timeouts, playback recovery, queue persistence, backup restore and large libraries |
| Reviewed viewport baselines | 4 | 1920 by 1080, 1280 by 900, 1000 by 800 and 390 by 844 |
| Responsive readability combinations | 8 | Four widths in dark and light themes |

The release build runs the Python suite before creating `AWUN.exe` and `AWUN-Setup-x64.exe`. The browser workflow installs its pinned Playwright version and Chromium before executing the full browser suite.

## Test layers

### Search and provider behavior

- Query intent, regional planning and text normalization.
- Concurrent provider execution and progressive completion.
- Deadline, retry, caching, rate limiting and circuit breaking.
- Stable track identity, deduplication and ranking.
- Failure isolation when one adapter returns an error.

### Playback and media safety

- Provider URL refresh before saved playback.
- Close-match fallback across connected providers.
- Stale playback requests cannot override a newer selection.
- Signed media tokens, safe outbound URL validation and response-header filtering.
- Client capability rules prevent download controls where the platform requires streaming only.

### Local data

- Library import and matching.
- Queue persistence and reordering.
- Backup schema validation and confirmation.
- Rollback after a partial storage failure.
- Redaction of secrets in runtime diagnostics.

### Browser behavior

- The first source can render before the slowest source completes.
- Cancellation keeps already received results and allows a retry.
- Opening the library prevents a late search from replacing the active screen.
- A 1,500-track library renders in pages without dropping stored items.
- Waveform seeking and play or pause state remain synchronized.
- Controls stay inside the player at every reviewed width.

## Run locally

```bash
python -m pytest -q
npm ci
npx playwright install --with-deps chromium
npm run test:e2e
```

To review an intentional visual change:

```bash
npm run test:e2e:update
git diff -- tests/e2e/awun.spec.js-snapshots
```

Updated baselines must be visually inspected. Passing snapshots are not evidence that a new layout is desirable; they only confirm agreement with the reviewed reference.

## Continuous integration

| Workflow | Gate |
| --- | --- |
| [Frontend browser tests](https://github.com/Loro66/AWUN/actions/workflows/frontend-e2e.yml) | All Playwright behavior and screenshot scenarios pass |
| [Windows desktop build](https://github.com/Loro66/AWUN/actions/workflows/build-windows-exe.yml) | Python tests pass, both executables build and checksums are generated |
| [Android unsigned Play bundle](https://github.com/Loro66/AWUN/actions/workflows/build-google-play-unsigned.yml) | Android lint and release bundle build pass |
| [Mobile test builds](https://github.com/Loro66/AWUN/actions/workflows/build-mobile.yml) | Installable Android test APK and unsigned iOS artifacts build |

The versioned Windows Release is published only after its build job succeeds. An existing version tag is not silently replaced.

## What these tests do not prove

Browser tests use controlled provider responses. They verify AWUN behavior under success, delay and failure, but they do not prove that every real track is available in every country. They also do not measure a user's network speed, long-term provider API stability, Windows audio-driver compatibility or product retention.

Those questions require monitored live operation and real user testing. The project does not convert automated test counts into unsupported adoption claims.
