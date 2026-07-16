import unittest

from backend.metadata.lyrics import attach_genius_referents, parse_plain_lyrics, parse_synced_lyrics


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

    def test_attaches_official_annotation_to_closest_line(self) -> None:
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


if __name__ == "__main__":
    unittest.main()
