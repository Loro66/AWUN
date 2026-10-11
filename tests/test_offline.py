import unittest
from unittest.mock import AsyncMock, patch
from types import SimpleNamespace

from backend.api.main import create_app, _apply_client_policy
from backend.core.config import Settings
from backend.core.media import MediaSigner
from backend.core.models import Track, SearchResponse
from backend.policy.rights import offline_decision
from backend.sources.internet_archive import InternetArchiveAdapter
from tests.test_local_audio import Client


class OfflineTests(unittest.TestCase):
    def test_policy_requires_provider_grant_and_full_recording(self):
        for source in ('audius','jamendo','internet_archive'):
            self.assertTrue(offline_decision(source,provider_grant=True).allowed)
            self.assertFalse(offline_decision(source,provider_grant=False).allowed)
            self.assertFalse(offline_decision(source,provider_grant=True,preview=True).allowed)
            self.assertFalse(offline_decision(source,provider_grant=True,play_store_client=True).allowed)
        for source in ('youtube','soundcloud','unknown'):
            self.assertFalse(offline_decision(source,provider_grant=True).allowed)

    def test_offline_permission_is_signed_and_stream_tokens_do_not_grant_it(self):
        signer=MediaSigner('test-secret')
        self.assertFalse(signer.verify(signer.sign('https://example.com/audio')).offline)
        self.assertTrue(signer.verify(signer.sign('https://example.com/audio',offline=True)).offline)

    def test_client_policy_only_exposes_granted_downloads(self):
        track=Track(id='a',title='Song',artist='Artist',duration=50,source='audius',quality='MP3',score=80,stream_url='https://example.com/stream',download_url='https://example.com/download',offline_grant=True)
        def response():return SearchResponse(query='song',tracks=[track.model_copy()],total=1,searched_sources=['audius'],region='AUTO',elapsed_ms=1)
        allowed=_apply_client_policy(response(),'web').tracks[0]
        self.assertTrue(allowed.offline_allowed);self.assertEqual(allowed.offline_url,track.download_url)
        self.assertIsNone(_apply_client_policy(response(),'android-play').tracks[0].offline_url)
        self.assertNotIn('offline_grant',allowed.model_dump())

    def test_archive_requires_an_actual_creative_commons_license_host(self):
        base={'metadata':{'identifier':'example','title':'Example','creator':'Artist'},'files':[{'name':'song.mp3','title':'Song'}]}
        for url,allowed in [('https://creativecommons.org/licenses/by/4.0/',True),('https://creativecommons.org.evil.example/licenses/by/4.0/',False),('',False)]:
            base['metadata']['licenseurl']=url
            self.assertEqual(InternetArchiveAdapter.tracks_from_metadata(base,'song')[0].offline_grant,allowed)

    def test_offline_proxy_rejects_an_ordinary_stream_token_before_network_access(self):
        settings=Settings(_env_file=None);app=create_app(settings);app.state.media_session=object()
        token=MediaSigner(settings.media_secret).sign('https://example.com/audio')
        with patch('backend.api.main._open_safe_media',new_callable=AsyncMock) as upstream:
            self.assertEqual(Client(app).get(f'/api/v1/media/{token}?offline=1').status_code,403)
            upstream.assert_not_called()

    def test_offline_proxy_blocks_hls_instead_of_saving_a_playlist_as_audio(self):
        settings=Settings(_env_file=None);app=create_app(settings);app.state.media_session=object()
        token=MediaSigner(settings.media_secret).sign('https://example.com/audio.m3u8',offline=True)
        upstream=SimpleNamespace(status=200,headers={'content-type':'application/vnd.apple.mpegurl'},url='https://example.com/audio.m3u8',release=lambda:None)
        with patch('backend.api.main._open_safe_media',new=AsyncMock(return_value=upstream)):
            self.assertEqual(Client(app).get(f'/api/v1/media/{token}?offline=1').status_code,409)
            self.assertEqual(Client(app).get(f'/api/v1/media/{token}?offline=1',headers={'X-AWUN-Client':'android-play'}).status_code,403)
