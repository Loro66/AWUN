# SongVale releases

[Development](DEVELOPMENT.md) · [Desktop](../desktop/README.md) · [Mobile](../mobile/README.md)

## Version and checks

`VERSION` is the canonical application version. Desktop, web and Android
packaging derive their version from it. Record user-visible changes in
[CHANGELOG.md](../CHANGELOG.md) and update [RELEASE_NOTES.md](RELEASE_NOTES.md)
before a Windows release.

Run the Python, JavaScript and browser suites. Review changed screenshots and
complete the platform-specific installation and playback checks before release.

## Windows

Run **Windows desktop build** in GitHub Actions. It produces the portable EXE,
per-user installer and SHA-256 files. A version change on `main` can publish
the tested files; existing tags are not silently replaced.

Configure the signing certificate secrets described in the desktop guide for
signed distribution. Without them, artifacts remain unsigned test builds.

## Web deployment

Use the repository `Dockerfile` or `render.yaml`. The deployment serves the
frontend and API together. Verify `/health`, `/`, `/privacy`, `/support`, `/license`
and `/eula`, then check actual search and playback. Configuration and optional
provider credentials are listed in the [technical reference](TECHNICAL_REFERENCE.md).

## Android and iOS

**Mobile test builds** produces internal Android and unsigned iOS artifacts.
The signed and unsigned Play workflows also package the current localized
listing with shared images. The standard `store-listing/android/<locale>`
layout is assembled by `scripts/package_play_listing.py`.

For signing, app-content declarations and store submission, use the
[Google Play checklist](../mobile/android/play-store/RELEASE_CHECKLIST.md).
Only current localized changelog files are kept in the working tree; older
notes remain in Git history and the main changelog.

Native iPhone distribution still requires Apple signing and device testing.
