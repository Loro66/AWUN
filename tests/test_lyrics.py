import unittest

from backend.metadata.lyrics import (
    attach_genius_referents,
    canonical_track_title,
    genius_candidate_score,
    genius_search_queries,
    parse_plain_lyrics,
    parse_synced_lyrics,
    select_genius_candidate,
    select_genius_lyrics_hint,
    select_lyric_candidate,
)


class LyricsTests(unittest.TestCase):
    def test_parses_and_sorts_synced_lyrics(self) -> None:
        lines = parse_synced_lyrics("[00:12.50]Second\n[00:03.00][00:04.00]First")

        self.assertEqual([line.text for line in lines], ["First", "First", "Second"])
        self.assertEqual([line.time for line in lines], [3.0, 4.0, 12.5])
        self.assertEqual([line.index for line in lines], [0, 1, 2])

    def test_plain_lyrics_skip_empty_rows(self) -> None:
        lines = parse_plain_lyrics("First\n\nSecond\n")
        self.assertEqual([line.text for line in lines], ["First", "Second"])
        self.assertTrue(all(line.time is None for line in lines))

    def test_attaches_genius_annotation_to_closest_line(self) -> None:
        lines = parse_plain_lyrics("We built this city\nAnother line")
        attach_genius_referents(
            lines,
            [
                {
                    "fragment": "We built this city",
                    "annotations": [
                        {
                            "id": 42,
                            "body": {"dom": {"tag": "root", "children": ["A reference ", {"tag": "em", "children": ["explained"]}]}},
                            "authors": [{"user": {"name": "Listener"}}],
                            "votes_total": 7,
                            "url": "https://genius.com/annotations/42",
                        }
                    ],
                }
            ],
        )

        self.assertEqual(len(lines[0].annotations), 1)
        self.assertEqual(lines[0].annotations[0].text, "A reference explained")
        self.assertEqual(lines[0].annotations[0].author, "Listener")
        self.assertEqual(lines[0].annotations[0].votes, 7)
        self.assertEqual(lines[1].annotations, [])

    def test_reduces_long_youtube_cover_title_to_canonical_song(self) -> None:
        title = "Bad Romance - Vintage 1920's Gatsby Style Lady Gaga Cover Ft. Ariana Savalas & Sarah Reich"
        self.assertEqual(canonical_track_title(title), "Bad Romance")

    def test_removes_official_video_noise_without_damaging_title(self) -> None:
        self.assertEqual(canonical_track_title("Bad Romance (Official Music Video)"), "Bad Romance")
        self.assertEqual(canonical_track_title("Bad Romance - Official Audio"), "Bad Romance")
        self.assertEqual(canonical_track_title("Love - Hate"), "Love - Hate")

    def test_selects_matching_lrclib_song_instead_of_first_result(self) -> None:
        candidates = [
            {"trackName": "A Bad Dream", "artistName": "Artist A", "duration": 250},
            {"trackName": "Bad Romance", "artistName": "Lady Gaga", "duration": 295},
            {"trackName": "Romance", "artistName": "Artist B", "duration": 240},
        ]
        selected = select_lyric_candidate(candidates, "Bad Romance", 292)
        self.assertIsNotNone(selected)
        self.assertEqual(selected["artistName"], "Lady Gaga")

    def test_lrclib_fallback_rejects_same_title_by_wrong_artist(self) -> None:
        candidates = [
            {"trackName": "Home", "artistName": "Wrong Band", "duration": 220},
            {"trackName": "Home", "artistName": "Edward Sharpe & The Magnetic Zeros", "duration": 221},
        ]
        selected = select_lyric_candidate(
            candidates,
            "Home",
            220,
            "Edward Sharpe and the Magnetic Zeros",
        )
        self.assertIsNotNone(selected)
        self.assertEqual(selected["artistName"], "Edward Sharpe & The Magnetic Zeros")

    def test_genius_match_prefers_artist_over_result_order(self) -> None:
        hits = [
            {
                "type": "song",
                "result": {
                    "id": 1,
                    "title": "Midnight Signal",
                    "artist_names": "Unrelated Artist",
                    "primary_artist": {"name": "Unrelated Artist"},
                },
            },
            {
                "type": "song",
                "result": {
                    "id": 2,
                    "title": "Midnight Signal",
                    "artist_names": "AWUN Artist",
                    "primary_artist": {"name": "AWUN Artist"},
                },
            },
        ]
        selected = select_genius_candidate(hits, "AWUN Artist", "Midnight Signal")
        self.assertIsNotNone(selected)
        self.assertEqual(selected[0]["id"], 2)
        self.assertGreater(selected[1], 0.9)

    def test_genius_match_rejects_wrong_recording_variant(self) -> None:
        candidate = {
            "title": "Midnight Signal (Live)",
            "artist_names": "AWUN Artist",
            "primary_artist": {"name": "AWUN Artist"},
        }
        self.assertEqual(genius_candidate_score(candidate, "AWUN Artist", "Midnight Signal"), 0.0)

    def test_genius_search_adds_distinctive_lyric_fallback(self) -> None:
        lines = parse_plain_lyrics(
            "Verse\nRun through the quiet forest where the midnight signal glows\nAgain"
        )
        hint = select_genius_lyrics_hint(lines)
        queries = genius_search_queries("AWUN Artist feat. Guest", "Midnight Signal (Official Audio)", lines)

        self.assertEqual(hint, "Run through the quiet forest where the midnight signal glows")
        self.assertEqual(queries[0], "AWUN Artist Midnight Signal")
        self.assertIn("Run through the quiet forest", queries[-1])


if __name__ == "__main__":
    unittest.main()
