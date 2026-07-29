"""Central capability model for web, desktop and Google Play builds."""

from dataclasses import dataclass
from typing import Any

from backend.policy.rights import MediaAction, decide_media_action


@dataclass(frozen=True, slots=True)
class ClientCapabilities:
    client_id: str
    downloads: bool
    background_playback: bool
    local_library: bool
    max_results: int

    @property
    def is_play_store(self) -> bool:
        return self.client_id == "android-play"


_CAPABILITIES = {
    "android-play": ClientCapabilities("android-play", False, False, True, 50),
    "android-direct": ClientCapabilities("android-direct", True, True, True, 100),
    "desktop": ClientCapabilities("desktop", True, True, True, 100),
    "web": ClientCapabilities("web", False, False, True, 50),
}


def capabilities_for(client_id: str | None) -> ClientCapabilities:
    normalized = (client_id or "web").strip().casefold()
    return _CAPABILITIES.get(normalized, _CAPABILITIES["web"])


def apply_track_capabilities(
    payload: dict[str, Any],
    capabilities: ClientCapabilities,
    *,
    rights_confirmed: bool = False,
) -> dict[str, Any]:
    """Return a sanitized copy of a serialized track for one distribution channel."""

    result = dict(payload)
    download_url = str(result.get("download_url") or "")
    decision = decide_media_action(
        str(result.get("source") or ""),
        MediaAction.DOWNLOAD,
        explicit_download_url=bool(download_url),
        rights_confirmed=rights_confirmed,
        play_store_client=capabilities.is_play_store,
    )
    if not capabilities.downloads or not decision.allowed:
        result["download_url"] = None
    result["rights_status"] = decision.reason
    result["client_capabilities"] = {
        "downloads": capabilities.downloads,
        "background_playback": capabilities.background_playback,
        "local_library": capabilities.local_library,
    }
    return result


def clamp_result_limit(requested: int, capabilities: ClientCapabilities) -> int:
    return max(1, min(requested, capabilities.max_results))
