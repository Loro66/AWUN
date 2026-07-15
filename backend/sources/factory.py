from backend.core.config import Settings
from backend.sources.audius import AudiusAdapter
from backend.sources.base import BaseAdapter
from backend.sources.jamendo import JamendoAdapter
from backend.sources.internet_archive import InternetArchiveAdapter
from backend.sources.soundcloud import SoundCloudAdapter
from backend.sources.youtube import YouTubeAdapter
from backend.search.enrichment import BasicQueryEnricher, MusicBrainzEnricher, QueryEnricher


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
    if settings.internet_archive_enabled:
        adapters.append(
            InternetArchiveAdapter(
                timeout=settings.ytdlp_socket_timeout_seconds,
                max_items=settings.internet_archive_max_items,
            )
        )
    return adapters


def build_enricher(settings: Settings) -> QueryEnricher:
    if settings.musicbrainz_enabled:
        return MusicBrainzEnricher(
            contact=settings.musicbrainz_contact,
            limit=settings.query_expansion_limit,
            timeout=min(8.0, settings.search_timeout_seconds / 3),
        )
    return BasicQueryEnricher(settings.query_expansion_limit)
