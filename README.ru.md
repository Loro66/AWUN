![SongVale](docs/media/songvale-banner.svg)

[English](README.md) · [Русский](README.ru.md)

# SongVale

Музыкальный плеер с локальной медиатекой, личной очередью и поиском по подключённым каталогам.

[**Скачать для Windows**](https://github.com/Loro66/AWUN/releases/latest/download/SONGVALE-Setup-x64.exe) · [**Открыть веб-версию**](https://awun-1.onrender.com) · [Все релизы](https://github.com/Loro66/AWUN/releases)

[![Сборка Windows](https://img.shields.io/github/actions/workflow/status/Loro66/AWUN/build-windows-exe.yml?branch=main&label=Windows)](https://github.com/Loro66/AWUN/actions/workflows/build-windows-exe.yml)
[![Браузерные тесты](https://img.shields.io/github/actions/workflow/status/Loro66/AWUN/frontend-e2e.yml?branch=main&label=Browser%20tests)](https://github.com/Loro66/AWUN/actions/workflows/frontend-e2e.yml)

![Главный экран SongVale](docs/media/songvale-home.webp)

## Возможности

- Поиск по YouTube, SoundCloud, Audius, Jamendo и Internet Archive. Доступность зависит от источника и региона.
- Избранное, именованные плейлисты и сохранённая очередь на устройстве.
- «Моя волна» и умные плейлисты для выбора следующей музыки.
- Импорт коллекций CSV, JSON, M3U и TXT с поиском совпадений.
- В Windows: мини-плеер поверх окон, трей и отключаемые глобальные сочетания клавиш.

## Установка

| Платформа | Что доступно |
| --- | --- |
| Windows | [Установщик](https://github.com/Loro66/AWUN/releases/latest/download/SONGVALE-Setup-x64.exe) или [portable EXE](https://github.com/Loro66/AWUN/releases/latest/download/SONGVALE.exe). Контрольные суммы SHA-256 находятся в релизе. |
| Веб / PWA | [Открыть SongVale](https://awun-1.onrender.com); при желании установить через Chrome или Edge. |
| iPhone | Открыть веб-версию в Safari → Поделиться → На экран «Домой». Нативная установка требует подписи Apple. |
| Android | Тестовые сборки создаются в GitHub Actions; публикация в магазине требует подписи и проверки. |

Бета-сборки Windows не подписаны, если не настроен сертификат. Поиск и стриминг требуют интернета; доступность внешних каталогов не гарантируется.

## Состояние релизов

Опубликованная Windows-версия — **2.6.3**. Тестовая **2.8.0** находится в [PR #64](https://github.com/Loro66/AWUN/pull/64) и ещё не включена в публичный релиз.

В тестовой версии добавлены страницы исполнителей и альбомов, локальные аудиофайлы, разрешённые офлайн-копии, объединение записей и непрерывное воспроизведение. Возможности установленной версии указаны в [истории изменений](CHANGELOG.md) и её релизе.

## Разработка и помощь проекту

Локальный запуск, тестирование и сборка Windows описаны в [руководстве разработчика](docs/DEVELOPMENT.md).

[Сообщить об ошибке](https://github.com/Loro66/AWUN/issues/new?template=bug_report.yml) · [Участие в разработке](CONTRIBUTING.md) · [Документация](docs/README.md) · [Поддержка](SUPPORT.md)

## Лицензия и музыкальные источники

Текущая версия — **проприетарная бесплатная программа с доступными для просмотра исходниками** на условиях [LICENSE.md](LICENSE.md) и [EULA.md](EULA.md). Публикация исходников не даёт дополнительных прав на их использование.

Лицензия кода SongVale не предоставляет права на музыку или сервисы провайдеров. YouTube работает через видимый официальный плеер; разрешения источников и ограничения скачивания продолжают действовать.

Автор — [Loro66](https://github.com/Loro66).
