# SongVale 2.7.1
Release date: 2026-10-20

Security and reliability fixes from the full project audit:
- Reject non-public outbound media addresses, including shared-address space; sandbox any document returned by a media source.
- Validate external download/annotation links before displaying them.
- Upgrade aiohttp to 3.14.5 with checked dependency hashes.
- Load fragmented account-library responses completely within the size budget.
- Preserve library owner, dirty revision and backup-restore guards across Windows restarts; exclude disposable caches from native snapshots.
- Separate Wave history/settings/blocked artists by owner. Preserve legacy unowned history as a guest profile.
- Apply likes/dislikes to a recording across sources. Seeking to the end no longer records a completed listen.
- Access rating, more/less similar and artist-block actions from Wave's fine tuning on desktop or phone.
- Pause a rejected track if the queue has no alternative and resume when an active continuous Wave finds new music.

See [the audit report](AUDIT-2026-10-20.md) for reproductions, validation and limitations.
The separate 2.8.0 preview in PR #64 remains unmerged and is not part of this release.
