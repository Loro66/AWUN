# Contributing to AWUN

[Project overview](README.md) · [Architecture](docs/ARCHITECTURE.md) · [Testing](docs/TESTING.md)

AWUN accepts focused bug reports and pull requests that improve verified product behavior. Start with the user problem, keep the change narrow and include evidence that it works.

## Report a problem

Use the [bug report form](https://github.com/Loro66/AWUN/issues/new?template=bug_report.yml). Include:

- AWUN version, platform and operating system;
- the affected source, when relevant;
- the shortest reproducible sequence;
- expected and actual behavior;
- sanitized diagnostics or screenshots.

Never post API keys, cookies, account tokens, authorization headers or personal data.

## Local setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm ci
```

Windows PowerShell activation is `.venv\Scripts\Activate.ps1`.

## Required checks

```bash
python -m pytest -q
node --check frontend/app.js
node --check frontend/flow.js
npm run test:e2e
```

Interface changes must be reviewed at 1920, 1280, 1000 and 390 pixels. Update screenshot baselines only after inspecting the rendered difference.

## Pull requests

- Explain the problem and the trade-offs of the chosen solution.
- Add or update tests for behavior changes.
- Update `CHANGELOG.md` when users will notice the change.
- Keep credentials and generated local data out of the repository.
- Preserve provider attribution, rights state and platform-specific download restrictions.
- Do not add DRM circumvention, private account scraping, fabricated search results or undocumented private APIs.

The pull-request template contains the complete verification checklist.

## Contributor license

AWUN is proprietary source-visible freeware. By submitting a pull request or other contribution, you agree to the [AWUN Contributor License Agreement](CONTRIBUTOR_LICENSE_AGREEMENT.md), including the project owner's right to use and relicense the contribution. Do not submit code if you cannot grant those rights.

## Русский

AWUN принимает конкретные отчёты об ошибках и небольшие проверяемые pull request. Укажи версию, платформу, источник, точные шаги воспроизведения и очищенные от секретов логи. Изменения интерфейса необходимо проверить на ширинах 1920, 1280, 1000 и 390 пикселей.

Изменения должны сохранять атрибуцию источников и правила доступа к медиа. Не допускаются обход DRM, закрытый scraping, подставные результаты и использование недокументированных приватных API.

Отправляя вклад, участник принимает [соглашение AWUN](CONTRIBUTOR_LICENSE_AGREEMENT.md#соглашение-с-участником-awun-10).
