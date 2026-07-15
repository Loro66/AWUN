# AWUN mobile shells

The Android and iOS projects are small native WebView shells for the hosted
AWUN beta. They retain browser storage, support media playback and open the
production URL `https://awun-api1.onrender.com`.

GitHub Actions produces three beta artifacts for every pull request:

- `AWUN-Android-beta.apk`: debug-signed and directly installable on Android.
- `AWUN-iOS-unsigned.ipa`: unsigned device build for re-signing with AltStore,
  Sideloadly or an Apple Developer certificate.
- `AWUN-iOS-Simulator.zip`: application bundle for an iOS Simulator.

A directly installable iPhone release must be signed with an Apple Developer
certificate and a provisioning profile. Those credentials must be provided as
encrypted GitHub secrets and must never be committed to the repository.
