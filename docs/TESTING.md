# SongVale testing

[Project](../README.md) · [Development](DEVELOPMENT.md) · [Architecture](ARCHITECTURE.md)

The tests exercise the runtime application and its packaging. Historical
standalone prototypes and their isolated tests have been removed.

| Layer | Checks |
| --- | --- |
| Python | Provider adapters, query expansion, search balancing and failures, media security, account gateway, desktop controls and packaging |
| JavaScript | Audio engine, library matching, smart playlists, rating weights, owner isolation and collection rules |
| Browser | Search, playback recovery, queue, import, library, ratings, continuous discovery, accounts, offline shell, mobile layouts and desktop controls |
| Visual | Reviewed reference screenshots at 1920, 1280, 1000 and 390 pixels |
| Store packaging | Current localized text and changelog, shared image dimensions and assembled Play listing |

The tests use controlled provider responses. A successful run does not establish
live catalog availability, physical-device audio behavior or public adoption.

## Run

```bash
python -m pytest -q
npm ci
npm run test:unit
npx playwright install --with-deps chromium
npm run test:e2e
```

For an intentional interface change, inspect the rendered difference before
using `npm run test:e2e:update`. Reference images must not be regenerated just to
make a failed cleanup pass.

## Continuous integration

[GitHub Actions](https://github.com/Loro66/AWUN/actions) runs the browser,
Windows, mobile and security checks. Windows packaging follows the Python
suite; the Play workflows assemble the store listing from shared images and
the current localized release notes. Existing release tags are not replaced.

Test counts come from the corresponding CI run rather than a fixed number in
this document.

## Library responsiveness measurement

A controlled Chromium comparison on 2026-10-17 used the same 1500 saved tracks,
1500 listening records, 60 visible rows and a 1280px viewport. After five warm-up
renders, five samples of twenty synchronous `app.render()` calls produced median
per-render times of 8.78ms before and 2.31ms after this change (about 3.8× faster).
Across 100 renders the smart-tab container changed 400 times before and zero
times after. These measurements cover warm library updates in the test runtime;
they are not measurements of live provider latency or a guarantee for every device.
