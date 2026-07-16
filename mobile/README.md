# AWUN mobile shells

The Android and iOS projects are small native WebView shells for the hosted
AWUN beta. They retain browser storage, support media playback and open the
production URL `https://awun-api1.onrender.com`. Both shells now use the AWUN
brand mark as the native app icon and splash identity.

## Optional mirror for networks where Render is unavailable

Deploy `deploy/russia-mirror` to a host reachable by your users (for example a
Russian cloud account you control), then add the public HTTPS address as the
GitHub Actions repository variable `AWUN_MIRROR_URL`. New Android and iOS beta
builds will automatically try the mirror if the primary Render address cannot
be opened. No user credentials or music tokens pass through this setting.

The mirror only serves the AWUN site and API. YouTube playback remains inside
the official YouTube Player and therefore follows YouTube's own regional and
network availability; AWUN does not proxy or download YouTube media.

GitHub Actions produces three beta artifacts for every pull request:

- `AWUN-Android-beta.apk`: debug-signed and directly installable on Android.
- `AWUN-iOS-unsigned.ipa`: unsigned device build for re-signing with AltStore,
  Sideloadly or an Apple Developer certificate.
- `AWUN-iOS-Simulator.zip`: application bundle for an iOS Simulator.

A directly installable iPhone release must be signed with an Apple Developer
certificate and a provisioning profile. Those credentials must be provided as
encrypted GitHub secrets and must never be committed to the repository.
