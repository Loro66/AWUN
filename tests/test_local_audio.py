import json
import asyncio
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import quote, urlencode, urlsplit

from fastapi import FastAPI
from backend.library.local_audio import LocalAudioStore, register_local_audio_routes


class Result:
    def __init__(self,status,body):
        self.status_code=status; self.content=body; self.text=body.decode(errors='replace')
    def json(self):
        return json.loads(self.content)


class Client:
    def __init__(self,app):self.app=app
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def close(self):pass
    def get(self,path,**kwargs):return self.request('GET',path,**kwargs)
    def post(self,path,**kwargs):return self.request('POST',path,**kwargs)
    def patch(self,path,**kwargs):return self.request('PATCH',path,**kwargs)
    def delete(self,path,**kwargs):return self.request('DELETE',path,**kwargs)
    def request(self,method,path,headers=None,content=None,json=None,params=None):
        raw=__import__('json').dumps(json).encode() if json is not None else content or b''
        async def run():
            status=0;body=bytearray();sent=False
            async def receive():
                nonlocal sent
                if sent:return {'type':'http.disconnect'}
                sent=True;return {'type':'http.request','body':raw,'more_body':False}
            async def send(message):
                nonlocal status
                if message['type']=='http.response.start':status=message['status']
                elif message['type']=='http.response.body':body.extend(message.get('body',b''))
            parsed=urlsplit(path)
            scope={'type':'http','asgi':{'version':'3.0','spec_version':'2.4'},'http_version':'1.1','method':method,'scheme':'http','path':parsed.path,'raw_path':parsed.path.encode(),'root_path':'','query_string':urlencode(params).encode() if params else parsed.query.encode(),'headers':[(b'host',b'testserver')]+[(k.lower().encode(),v.encode()) for k,v in (headers or {}).items()],'server':('testserver',80),'client':('127.0.0.1',1234)}
            await self.app(scope,receive,send)
            return Result(status,bytes(body))
        return asyncio.run(run())


class LocalAudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.store = LocalAudioStore(self.directory)
        self.client = self.make_client(self.store)
        self.headers = {"X-Songvale-Local-Token": self.store.token, "Origin": "http://testserver", "Content-Type": "audio/wav", "X-Songvale-Local-Metadata": quote(json.dumps({"title": "One", "artist": "Example", "album": "Album"}))}

    def tearDown(self):
        self.client.close(); self.temp.cleanup()

    def make_client(self, store):
        app = FastAPI(); register_local_audio_routes(app, store); return Client(app)

    def upload(self, body=b"RIFFexample"):
        response = self.client.post("/api/v1/local-audio", content=body, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["track"]

    def test_public_server_does_not_expose_local_audio_routes(self):
        with self.make_client(None) as client:
            self.assertEqual(client.get("/api/v1/local-audio").status_code, 404)

    def test_token_and_origin_are_both_required(self):
        response = self.client.post("/api/v1/local-audio", content=b"x", headers={**self.headers,"Origin":"https://other.example"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.get("/api/v1/local-audio").status_code, 403)

    def test_duplicate_bytes_keep_one_file_and_original_metadata(self):
        first = self.upload(); self.headers["X-Songvale-Local-Metadata"] = quote('{"title":"Different"}')
        second = self.upload()
        self.assertEqual(first, second)
        self.assertEqual(len(self.store.tracks()), 1)

    def test_range_playback_and_restart_with_a_new_token(self):
        track = self.upload()
        response = self.client.get(f'/api/v1/local-audio/{track["file_id"]}', params={"token":self.store.token}, headers={"Range":"bytes=0-3"})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, b"RIFF")
        restarted = LocalAudioStore(self.directory)
        with self.make_client(restarted) as client:
            self.assertEqual(client.get("/api/v1/local-audio",headers={"X-Songvale-Local-Token":self.store.token}).status_code,403)
            self.assertEqual(client.get("/api/v1/local-audio",headers={"X-Songvale-Local-Token":restarted.token}).json()["tracks"][0]["id"],track["id"])

    def test_oversized_upload_leaves_no_partial_file(self):
        with patch("backend.library.local_audio.MAX_FILE_BYTES",4):
            self.assertEqual(self.client.post("/api/v1/local-audio",content=b"12345",headers=self.headers).status_code,413)
        self.assertEqual(list(self.directory.iterdir()),[])

    def test_empty_and_invalid_metadata_are_rejected(self):
        self.assertEqual(self.client.post("/api/v1/local-audio",content=b"",headers=self.headers).status_code,400)
        self.assertEqual(self.client.post("/api/v1/local-audio",content=b"x",headers={**self.headers,"X-Songvale-Local-Metadata":"[]"}).status_code,400)

    def test_edit_cannot_change_id_or_source_and_delete_removes_audio(self):
        track=self.upload(); path=f'/api/v1/local-audio/{track["file_id"]}'
        response=self.client.patch(path,headers=self.headers,json={"title":"Edited","source":"youtube","file_id":"../other"})
        self.assertEqual(response.status_code,200)
        updated=response.json()["track"]
        self.assertEqual(updated["source"],"local");self.assertEqual(updated["file_id"],track["file_id"])
        self.assertEqual(self.client.delete(path,headers=self.headers).status_code,200)
        self.assertEqual(self.store.tracks(),[])
        self.assertFalse((self.directory/track["file_id"]).exists())

    def test_symlinks_cannot_expose_other_files(self):
        track=self.upload();path=self.directory/track["file_id"];path.unlink()
        try:
            path.symlink_to(self.directory/"library.sqlite3")
        except OSError:
            self.skipTest("Symlinks unavailable")
        response=self.client.get(f'/api/v1/local-audio/{track["file_id"]}',params={"token":self.store.token})
        self.assertEqual(response.status_code,404)

    def test_failed_index_write_keeps_preexisting_audio(self):
        import sqlite3
        import hashlib
        body = b"RIFFexisting"
        path = self.directory / hashlib.sha256(body).hexdigest()
        path.write_bytes(body)
        with patch.object(self.store, "save", side_effect=sqlite3.OperationalError("disk full")):
            response = self.client.post("/api/v1/local-audio", content=body, headers=self.headers)
        self.assertEqual(response.status_code, 507)
        self.assertEqual(path.read_bytes(), body)

    def test_failed_delete_rolls_back_audio_and_metadata(self):
        import sqlite3
        track = self.upload()
        with patch.object(self.store, "database", side_effect=sqlite3.OperationalError("busy")):
            response = self.client.delete(f'/api/v1/local-audio/{track["file_id"]}', headers=self.headers)
        self.assertEqual(response.status_code, 507)
        self.assertTrue((self.directory / track["file_id"]).is_file())
        self.assertEqual(self.store.tracks()[0]["id"], track["id"])
