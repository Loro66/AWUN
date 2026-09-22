# Security policy / Политика безопасности

## Supported version

| Version | Security updates |
| --- | --- |
| 2.5.x | Supported |
| Earlier beta versions | Not supported |

## Reporting a vulnerability

Do not disclose credentials or an exploitable vulnerability in a public issue. Use [GitHub private vulnerability reporting](https://github.com/Loro66/AWUN/security/advisories/new). Include the affected version, reproduction steps and impact; omit real user data. You should receive an initial response within seven days.

Не публикуй ключи или рабочую уязвимость в открытом Issue. Используй [закрытый отчёт GitHub](https://github.com/Loro66/AWUN/security/advisories/new). Укажи затронутую версию, шаги воспроизведения и влияние, но не прикладывай реальные данные пользователей. Первый ответ должен поступить в течение семи дней.

Supported security work includes DNS-pinned SSRF prevention in URL imports,
short-lived media tokens, secret isolation, dependency updates and safe handling
of provider redirects. Dependency audits and CodeQL run for pull requests, main
and a weekly schedule. GitHub Actions are pinned to immutable commit IDs.
