"""Conservative source-rights decisions for playback and downloads."""

from dataclasses import dataclass
from enum import Enum


class MediaAction(str, Enum):
    DISCOVER = "discover"
    STREAM = "stream"
    DOWNLOAD = "download"


@dataclass(frozen=True, slots=True)
class SourceRights:
    source: str
    discovery: bool
    streaming: bool
    download_requires_explicit_grant: bool
    attribution_required: bool
    terms_url: str


@dataclass(frozen=True, slots=True)
class RightsDecision:
    allowed: bool
    reason: str
    attribution_required: bool = False
    terms_url: str | None = None


SOURCE_RIGHTS: dict[str, SourceRights] = {
    "youtube": SourceRights(
        "youtube", True, True, True, True, "https://www.youtube.com/static?template=terms"
    ),
    "soundcloud": SourceRights(
        "soundcloud", True, True, True, True, "https://soundcloud.com/terms-of-use"
    ),
    "audius": SourceRights(
        "audius", True, True, True, True, "https://audius.org/legal/terms-of-use"
    ),
    "jamendo": SourceRights(
        "jamendo", True, True, True, True, "https://devportal.jamendo.com/api_terms_of_use"
    ),
    "internet_archive": SourceRights(
        "internet_archive", True, True, True, True, "https://archive.org/about/terms.php"
    ),
}


def decide_media_action(
    source: str,
    action: MediaAction,
    *,
    explicit_download_url: bool = False,
    rights_confirmed: bool = False,
    play_store_client: bool = False,
) -> RightsDecision:
    """Return a safe product decision, not a legal conclusion about a recording."""

    policy = SOURCE_RIGHTS.get(source)
    if policy is None:
        return RightsDecision(False, "unknown_source")
    if action is MediaAction.DISCOVER:
        return RightsDecision(policy.discovery, "catalog_metadata", terms_url=policy.terms_url)
    if action is MediaAction.STREAM:
        return RightsDecision(
            policy.streaming,
            "provider_stream",
            policy.attribution_required,
            policy.terms_url,
        )
    if play_store_client:
        return RightsDecision(False, "downloads_disabled_in_play_build", terms_url=policy.terms_url)
    if not explicit_download_url:
        return RightsDecision(False, "provider_did_not_supply_download", terms_url=policy.terms_url)
    if policy.download_requires_explicit_grant and not rights_confirmed:
        return RightsDecision(False, "recording_rights_not_confirmed", terms_url=policy.terms_url)
    return RightsDecision(True, "explicit_provider_grant", policy.attribution_required, policy.terms_url)
