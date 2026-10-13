# Development

[Project](../README.md) · [Contributing](../CONTRIBUTING.md) · [Documentation](README.md)

## Run locally

Use Python 3.11 or newer and Node.js 22 for the frontend tests.

```bash
git clone https://github.com/Loro66/AWUN.git
cd AWUN
python -m venv .venv
source .venv/bin/activate
pip install --require-hashes -r requirements.lock
uvicorn backend.api.main:app --reload
```

In Windows PowerShell, activate with `.venv\Scripts\Activate.ps1`.
Open `http://127.0.0.1:8000`. Provider credentials are optional; see
[`.env.example`](../.env.example) and the [technical reference](TECHNICAL_REFERENCE.md).
Never commit an actual `.env` file or credentials.

## Checks

```bash
pip install pytest==9.1.1
python -m pytest -q
npm ci
npm run test:unit
npx playwright install --with-deps chromium
npm run test:e2e
```

See [TESTING.md](TESTING.md) for the test layers and limitations.
Review visual changes before updating screenshot baselines.

## Windows packaging

From the repository root on Windows:

```bat
scripts\build-windows.bat
```

The script changes to the repository root itself, creates `.venv-desktop`,
prepares the optional network runtime and builds `dist\SONGVALE.exe`.
PyInstaller uses [`desktop/SONGVALE.spec`](../desktop/SONGVALE.spec).

GitHub Actions additionally creates the installer with
[`installer/SONGVALE.iss`](../installer/SONGVALE.iss), checksums and artifacts.
Release notes are maintained in [RELEASE_NOTES.md](RELEASE_NOTES.md).
See the [release guide](RELEASE.md) and [desktop documentation](../desktop/README.md)
for signing, updates and platform-specific checks.

## Repository layout

| Folder | Contents |
| --- | --- |
| `backend/` | API, search, provider adapters and media policy |
| `frontend/` | Player interface and on-device state |
| `desktop/` | Windows launcher, controls, updater and PyInstaller spec |
| `installer/` | Windows installer |
| `mobile/` | Android and iOS clients and store metadata |
| `scripts/` | Local build entry points |
| `tests/` | Python, JavaScript and browser checks |
| `docs/` | Architecture, configuration, roadmap and release documentation |

Application identifiers, storage keys and `AWUN_` environment variables keep
their existing names for compatibility with installed versions.
