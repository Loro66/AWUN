from backend.core.config import Settings
from backend.sources.base import BaseAdapter
from backend.sources.soundcloud import SoundCloudAdapter
from backend.sources.vk import VKAdapter
from backend.sources.youtube import YouTubeAdapter


def build_adapters(settings: Settings) -> list[BaseAdapter]:
    adapters: list[BaseAdapter] = []
    if settings.youtube_enabled and settings.youtube_api_key:
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
    if settings.vk_enabled and settings.vk_access_token:
        adapters.append(
            VKAdapter(
                access_token=settings.vk_access_token,
                api_version=settings.vk_api_version,
                timeout=settings.ytdlp_socket_timeout_seconds,
            )
        )
    return adapters
