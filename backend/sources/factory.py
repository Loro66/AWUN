from backend.core.config import Settings
from backend.sources.audius import AudiusAdapter
from backend.sources.base import BaseAdapter
from backend.sources.jamendo import JamendoAdapter
from backend.sources.soundcloud import SoundCloudAdapter
from backend.sources.youtube import YouTubeAdapter


def build_adapters(settings: Settings) -> list[BaseAdapter]:
    adapters: list[BaseAdapter] = []
    if settings.youtube_enabled:
        adapters.append(
            YouTubeAdapter(
                api_key=settings.youtube_api_key,
                timeout=settings.ytdlp_socket_timeout_seconds,
            )
        )
    if settings.soundcloud_enabled:
        adapters.append(
            SoundCloudAdapter(
                timeout=settings.ytdlp_socket_timeout_seconds,
                client_id=settings.soundcloud_client_id,
                client_secret=settings.soundcloud_client_secret,
            )
        )
    if settings.audius_enabled:
        adapters.append(
            AudiusAdapter(
                app_name=settings.audius_app_name,
                api_key=settings.audius_api_key,
                timeout=settings.ytdlp_socket_timeout_seconds,
            )
        )
    if settings.jamendo_enabled and settings.jamendo_client_id:
        adapters.append(
            JamendoAdapter(
                client_id=settings.jamendo_client_id,
                timeout=settings.ytdlp_socket_timeout_seconds,
            )
        )
    return adapters
