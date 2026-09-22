import asyncio
import socket

import pytest

from backend.importers.library_url import (
    LibraryImportError,
    _PinnedResolver,
    _public_addresses,
    structured_tracks,
)


def test_structured_music_playlist_tracks_are_extracted_and_deduplicated() -> None:
    documents = [{
        "@type": "MusicPlaylist",
        "name": "Public mix",
        "track": [
            {"@type": "MusicRecording", "name": "Song", "byArtist": {"name": "Artist"}},
            {"@type": "MusicRecording", "name": "Song", "byArtist": {"name": "Artist"}},
            {"@type": "MusicRecording", "name": "Second", "artist": "Other"},
        ],
    }]

    tracks = structured_tracks(documents, 100)

    assert [(track.artist, track.title) for track in tracks] == [("Artist", "Song"), ("Other", "Second")]


def test_structured_item_list_is_supported() -> None:
    tracks = structured_tracks([{"@type": "ItemList", "itemListElement": [{"@type": "ListItem", "item": {"@type": "MusicRecording", "name": "Track", "creator": {"name": "Band"}}}]}], 10)
    assert len(tracks) == 1
    assert tracks[0].artist == "Band"


def test_playlist_dns_rejects_mixed_public_and_private_answers(monkeypatch) -> None:
    def addresses(*args, **kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443)),
        ]

    monkeypatch.setattr(socket, "getaddrinfo", addresses)

    with pytest.raises(LibraryImportError, match="приватную"):
        asyncio.run(_public_addresses("playlist.example"))


def test_pinned_resolver_never_resolves_a_redirect_host() -> None:
    resolver = _PinnedResolver("playlist.example", ["8.8.8.8"])

    async def scenario() -> None:
        records = await resolver.resolve("playlist.example", 443)
        assert [record["host"] for record in records] == ["8.8.8.8"]
        with pytest.raises(OSError, match="unexpected host"):
            await resolver.resolve("metadata.internal", 443)

    asyncio.run(scenario())
