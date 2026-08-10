# AWUN — Play Console app-content answers

## Store setup

- App or game: **App**
- Category: **Music & Audio**
- Free or paid: **Free**
- Default language: **Russian — ru-RU**
- App name: **AWUN — поиск музыки**
- Package name: **com.loro66.awun**

The package name becomes permanent after the first uploaded bundle. If a Play
Console draft already exists with another package, resolve that before upload.

## App content declarations

| Declaration | Prepared answer |
|---|---|
| Privacy policy | `https://awun-1.onrender.com/privacy` after public HTTP 200 verification |
| Ads | No |
| App access | All functionality is available without an account or special access |
| Target audience | Ages 16–17 and 18+ |
| Designed for children | No |
| News app | No |
| COVID-19 app | No |
| Government app | No |
| Financial features | No |
| Health features | No |
| Data safety | Use `DATA_SAFETY.md` |
| High-risk permissions | None |

## Content-rating notes

AWUN searches external music catalogs and can display provider-supplied titles,
artwork, lyrics and playable media. It does not provide chat, public posting,
gambling, purchases, location sharing or user-to-user communication. External
music may contain mature themes or explicit language, so answer the IARC
questions conservatively instead of selecting an all-ages rating by assumption.

## Reviewer instructions

No credentials are required.

1. Open AWUN with internet access.
2. Search for an artist and track.
3. Open a non-YouTube result to test source-permitted audio.
4. Open a YouTube result to verify the visible official YouTube player.
5. Save a result, open **Моя музыка**, and start **Моя волна**.
6. Open **Конфиденциальность** from the footer.

The Google Play build removes all music-download controls and stops playback
when the Android activity goes into the background. External catalog links open
in the user's default browser.

## Intellectual-property review notes

- AWUN does not claim ownership of third-party music.
- Store artwork uses only the AWUN brand and fictional track examples.
- YouTube playback stays in the visible official player.
- The Play client identifies itself with `X-AWUN-Client: android-play`; the API
  removes every `download_url` from its search response.
- The native app has no download listener and no storage permission.
