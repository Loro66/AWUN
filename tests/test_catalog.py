import asyncio
import unittest
from fastapi import HTTPException
from backend.metadata.catalog import CatalogService


ARTIST = "12345678-1234-1234-1234-123456789abc"
ALBUM = "12345678-1234-1234-1234-123456789def"


class Client:
    def __init__(self):
        self.calls = []

    async def get_json(self, path, params):
        self.calls.append((path, params))
        await asyncio.sleep(0.01)
        if path == "artist/":
            return {"artists": [{"id": ARTIST, "name": "Example", "score": 100}]}
        if path.startswith("artist/"):
            return {"name": "Example"}
        if path == "release-group/":
            return {"release-groups": [{"id": ALBUM, "title": "Example album"}], "release-group-count": 51}
        if path.startswith("release-group/"):
            return {"title": "Example album", "artist-credit": [{"name": "Example"}], "releases": [{"id": "bootleg", "status": "Bootleg", "date": "1990"}, {"id": "official", "status": "Official", "date": "2000"}]}
        return {"id": "official", "media": [{"position": 1, "tracks": [{"position": 1, "title": "One", "length": 120000, "recording": {"id": "recording-one"}}]}, {"position": 2, "tracks": [{"position": 1, "title": "Two", "length": 180000, "recording": {"id": "recording-two"}}]}]}


class CatalogTests(unittest.IsolatedAsyncioTestCase):
    async def test_duplicate_requests_share_one_task_and_cache(self):
        client = Client(); service = CatalogService(client)
        first, second = await asyncio.gather(service.artists("Example"), service.artists("Example"))
        self.assertEqual(first, second)
        await service.artists("Example")
        self.assertEqual(len(client.calls), 1)

    async def test_search_quotes_are_escaped(self):
        client = Client(); await CatalogService(client).artists('A "B"')
        self.assertEqual(client.calls[0][1]["query"], 'artist:"A \\"B\\""')

    async def test_releases_expose_pagination_and_are_not_audio(self):
        result = await CatalogService(Client()).albums(ARTIST, 50)
        self.assertEqual(result["offset"], 50)
        self.assertEqual(result["total"], 51)
        self.assertNotIn("stream_url", result["albums"][0])

    async def test_album_keeps_disc_order_and_uses_official_edition(self):
        client = Client(); result = await CatalogService(client).album(ALBUM)
        self.assertEqual(result["release_id"], "official")
        self.assertEqual([t["title"] for t in result["tracks"]], ["One", "Two"])
        self.assertEqual([t["disc"] for t in result["tracks"]], [1, 2])
        self.assertEqual(result["tracks"][0]["duration"], 120)

    async def test_disabled_catalog_is_explicit(self):
        with self.assertRaises(HTTPException) as error:
            await CatalogService(None).artists("Example")
        self.assertEqual(error.exception.status_code, 503)

    async def test_failure_is_retryable_and_does_not_poison_cache(self):
        client = Client(); good = client.get_json
        async def broken(*args):
            raise RuntimeError("offline")
        client.get_json = broken; service = CatalogService(client)
        with self.assertRaises(HTTPException):
            await service.artists("Example")
        client.get_json = good
        self.assertEqual((await service.artists("Example"))["artists"][0]["name"], "Example")
