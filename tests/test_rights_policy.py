import pytest

from backend.policy.rights import MediaAction, SOURCE_RIGHTS, decide_media_action


@pytest.mark.parametrize("source", sorted(SOURCE_RIGHTS))
def test_all_supported_sources_allow_metadata_discovery(source: str) -> None:
    decision = decide_media_action(source, MediaAction.DISCOVER)

    assert decision.allowed
    assert decision.terms_url


def test_unknown_source_is_denied_by_default() -> None:
    assert decide_media_action("mystery", MediaAction.STREAM).allowed is False


def test_play_store_download_is_denied_even_with_url_and_rights() -> None:
    decision = decide_media_action(
        "internet_archive",
        MediaAction.DOWNLOAD,
        explicit_download_url=True,
        rights_confirmed=True,
        play_store_client=True,
    )

    assert decision.allowed is False
    assert decision.reason == "downloads_disabled_in_play_build"


def test_download_needs_both_provider_url_and_confirmed_rights() -> None:
    no_url = decide_media_action(
        "jamendo", MediaAction.DOWNLOAD, rights_confirmed=True
    )
    no_rights = decide_media_action(
        "jamendo", MediaAction.DOWNLOAD, explicit_download_url=True
    )
    allowed = decide_media_action(
        "jamendo",
        MediaAction.DOWNLOAD,
        explicit_download_url=True,
        rights_confirmed=True,
    )

    assert no_url.reason == "provider_did_not_supply_download"
    assert no_rights.reason == "recording_rights_not_confirmed"
    assert allowed.allowed is True
    assert allowed.attribution_required is True
