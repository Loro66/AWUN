# Contributing / Участие в разработке

AWUN accepts focused bug reports and pull requests. Before opening an issue, include the browser or operating system, the source involved, exact reproduction steps and sanitized logs. Never post API keys, cookies, account tokens or personal data.

AWUN принимает конкретные сообщения об ошибках и pull request. Укажи браузер или ОС, источник, точные шаги воспроизведения и очищенные от секретов логи. Никогда не публикуй API-ключи, cookies, токены аккаунтов или личные данные.

## Local checks

```bash
python -m pytest -q
node --check frontend/app.js
node --check frontend/flow.js
```

Contributions must use documented public APIs, preserve provider attribution and avoid DRM circumvention, private scraping or fabricated search results.

Изменения должны использовать документированные публичные API, сохранять атрибуцию источников и не добавлять обход DRM, закрытый scraping или подставные результаты.

## Contributor license / Лицензия участника

AWUN is proprietary source-visible freeware. By submitting a pull request or
other contribution, you agree to the
[AWUN Contributor License Agreement](CONTRIBUTOR_LICENSE_AGREEMENT.md), including
the right for the project owner to use and relicense the contribution. Do not
submit code if you cannot grant those rights.

AWUN — проприетарное freeware-ПО с доступным для просмотра кодом. Отправляя pull
request или другой вклад, вы принимаете
[соглашение с участником AWUN](CONTRIBUTOR_LICENSE_AGREEMENT.md#соглашение-с-участником-awun-10),
включая право владельца проекта использовать и перелицензировать вклад. Не
отправляйте код, если не можете предоставить эти права.
