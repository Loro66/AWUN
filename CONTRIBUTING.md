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
