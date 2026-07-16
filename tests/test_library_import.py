from backend.importers.library_url import structured_tracks


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
