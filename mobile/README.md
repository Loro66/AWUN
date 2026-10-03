# SONGVALE mobile

## Android / Google Play

The Android app is a hardened native WebView client for the owned SONGVALE web/API
deployment. It keeps browser storage for the local library and My Wave profile,
opens third-party catalog links in the user's browser, pauses playback whenever
the activity goes to the background, and displays a localized offline/retry
screen if every configured SONGVALE endpoint is unavailable.

Google Play identity:

- application ID: `com.loro66.awun`;
- version: read from the repository `VERSION` file (`2.5.6` currently);
- version code: derived from `VERSION` by Gradle (`2050600` currently);
- minimum Android: 7.0 / API 24;
- compile and target SDK: Android 16 / API 36;
- release format: signed Android App Bundle (`.aab`);
- permissions: internet and network state only.

The Play client adds `platform=android-play` and the
legacy `X-AWUN-Client: android-play` compatibility header. The frontend hides downloads and the API
removes every `download_url` for that client. YouTube remains in its visible
official player and playback stops when SONGVALE leaves the foreground.

Run the **Mobile test builds** workflow for a debug-signed internal APK. Run
**Android Google Play release** manually to build a release AAB after the Play
Console account owner has configured the four upload-key secrets documented in
[`android/play-store/RELEASE_CHECKLIST.md`](android/play-store/RELEASE_CHECKLIST.md).
The workflow does not upload or publish anything to Google Play.

Store text and images are under `android/fastlane/metadata/android`. Data safety,
app-content answers and the release checklist are under `android/play-store`.

## Optional owned mirror

`AWUN_MIRROR_URL` may point to a second HTTPS deployment controlled by the SONGVALE
operator. The Android client validates HTTPS endpoints and tries the mirror only
after the primary endpoint fails. Never set this variable to an unrelated proxy.

The mirror only serves the SONGVALE site and API. YouTube playback remains inside
the official YouTube Player and follows YouTube's own availability; SONGVALE does
not proxy or download YouTube media.

## iOS

For an iPhone today, open [the hosted SONGVALE site](https://awun-1.onrender.com)
in Safari and choose Share → Add to Home Screen → Add. This installs the web app
with a Home Screen icon and does not require Apple signing. Search and streaming
still need internet. Local favorites and playlists are not synced between devices.

The iOS project remains an unsigned beta shell for the hosted SONGVALE deployment.
GitHub Actions produces an unsigned device archive and a Simulator build. A
direct App Store release still requires an Apple Developer account, signing
certificate and provisioning profile; those credentials must never be committed.
