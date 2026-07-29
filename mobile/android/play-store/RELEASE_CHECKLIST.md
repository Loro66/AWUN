# AWUN 1.8.0 — Google Play release checklist

## 1. Account owner

- [ ] The Play Console account owner is at least 18 years old.
- [ ] The owner accepts the Developer Distribution Agreement and pays Google's
  one-time US$25 registration fee.
- [ ] Identity, payment profile, public developer email and Android-device
  verification are complete.
- [ ] Two-step verification is enabled.

Google does not allow a person under 18 to register a Play Console account.
If the AWUN founder is still under 18, a parent, guardian or another trusted
adult must legally own and verify the account. Do not submit false age or
identity information.

## 2. Permanent app identity

- [ ] Create an **App**, default language **Russian**, name
  **AWUN — поиск музыки**, distribution **Free**.
- [ ] Confirm the permanent package ID is `com.loro66.awun` before the first
  bundle upload.
- [ ] Enroll in Play App Signing and let Google create the app-signing key.

## 3. Upload key and GitHub secrets

The verified adult account owner should create and retain the upload key. Never
commit the `.jks` file or passwords.

Required repository secrets:

- `PLAY_UPLOAD_KEYSTORE_BASE64`
- `PLAY_UPLOAD_STORE_PASSWORD`
- `PLAY_UPLOAD_KEY_ALIAS`
- `PLAY_UPLOAD_KEY_PASSWORD`

Optional repository variable:

- `AWUN_MIRROR_URL` — an owned HTTPS AWUN deployment only.

Run **Android Google Play release** manually. For the first build use version
code `18000` and version name `1.8.0`. Download the workflow artifact and upload
its signed `.aab`; keep `mapping.txt` for de-obfuscated crash reports.

## 4. Public pages and listing

- [ ] Deploy the release and confirm `/`, `/health`, `/privacy`, `/support`,
  `/license` and `/eula` all return HTTP 200.
- [ ] Confirm a real search and playback work without reviewer credentials.
- [ ] Copy ru-RU and en-US text from `fastlane/metadata/android`.
- [ ] Upload the 512×512 icon, 1024×500 feature graphic and phone screenshots.
- [ ] Use `APP_CONTENT.md` and `DATA_SAFETY.md` to complete declarations.
- [ ] Complete the IARC content-rating questionnaire conservatively.
- [ ] Select supported countries only after provider and legal review.

## 5. Testing before production

- [ ] Upload the AAB to **Internal testing** first and install it from Google
  Play on a physical Android device.
- [ ] Test search, all enabled providers, foreground/background behavior,
  external links, rotation, offline retry and local persistence.
- [ ] Check Android vitals, pre-launch report and policy warnings.
- [ ] For a new personal developer account, run a **Closed test** with at least
  12 opted-in testers continuously for 14 days, then apply for production access.
- [ ] Keep testers enrolled for the whole 14-day period and collect meaningful
  feedback for the production-access questionnaire.

## 6. Production release

- [ ] Verify the version code is higher than every previously uploaded build.
- [ ] Paste localized release notes from the `changelogs/18000.txt` files.
- [ ] Submit with managed publishing enabled.
- [ ] After approval, use a staged rollout and monitor crashes and provider
  failures before increasing availability.
