from backend.policy.client_capabilities import (
    apply_track_capabilities,
    capabilities_for,
    clamp_result_limit,
)


def track_payload() -> dict[str, object]:
    return {
        "id": "archive:1",
        "source": "internet_archive",
        "stream_url": "https://archive.org/audio.mp3",
        "download_url": "https://archive.org/audio.mp3",
    }


def test_google_play_capabilities_disable_download_and_background_playback() -> None:
    capabilities = capabilities_for(" Android-Play ")
    result = apply_track_capabilities(track_payload(), capabilities, rights_confirmed=True)

    assert capabilities.is_play_store
    assert result["download_url"] is None
    assert result["rights_status"] == "downloads_disabled_in_play_build"
    assert result["client_capabilities"]["background_playback"] is False


def test_desktop_allows_explicit_rights_confirmed_download() -> None:
    capabilities = capabilities_for("desktop")
    result = apply_track_capabilities(track_payload(), capabilities, rights_confirmed=True)

    assert result["download_url"] == "https://archive.org/audio.mp3"
    assert result["rights_status"] == "explicit_provider_grant"


def test_unknown_client_falls_back_to_restricted_web_profile() -> None:
    capabilities = capabilities_for("unrecognized")

    assert capabilities.client_id == "web"
    assert capabilities.downloads is False


def test_result_limit_is_clamped_for_distribution_channel() -> None:
    play = capabilities_for("android-play")

    assert clamp_result_limit(0, play) == 1
    assert clamp_result_limit(75, play) == 50
    assert clamp_result_limit(20, play) == 20


def test_original_track_payload_is_not_mutated() -> None:
    original = track_payload()
    apply_track_capabilities(original, capabilities_for("web"))

    assert original["download_url"] == "https://archive.org/audio.mp3"
