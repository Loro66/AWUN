# SongVale 2.7.0
Release date: 2026-10-17

- Rate tracks from 1 to 5 for overall impression, melody, vocals, rhythm and atmosphere. Open a track's Queue menu → Rate track, or use Rate track in Wave settings.
- Adjust each rating's importance; missing ratings do not lower the weighted score.
- Find My top picks, Rhythm and drive, and Atmosphere in My music. Create up to 20 automatic collections with rating thresholds, artist/source filters and optional unrated tracks. Collections also include tracks saved only in named playlists.
- Choose a seed collection, artist separation and continuous discovery in Wave's fine tuning. It refills near the end of the queue and on scrolling, and provides a More recommendations button.
- Wave rotates queries and suppresses recent recordings across providers while keeping live/remix versions distinct. It uses bounded queues and a 12-second search deadline. When no new tracks are found or a source fails, retry is explicit; a truly unlimited catalog is not guaranteed.
- Faster library updates: cached inventory/history/rules, reusable tabs, indexed filtering and deferred passive taste-profile writes.

Ratings, weights and collection rules stay on this device, are separated by account,
and are included in full device backups. They do not sync through the optional
cloud library service or the library-only transfer file.

Windows downloads: SONGVALE-Setup-x64.exe (installer) and SONGVALE.exe (portable).
Existing Windows controls, themes, playback and the opt-in network helper remain included.
The separate 2.8.0 local-audio/artist-page preview in PR #64 remains unmerged.
