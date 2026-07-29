import pytest

from backend.security.safe_url import UnsafeUrl, validate_outbound_url


def test_public_https_url_is_normalized() -> None:
    result = validate_outbound_url("HTTPS://cdn.example.com/audio.mp3?x=1#fragment")

    assert result.url == "https://cdn.example.com/audio.mp3?x=1"
    assert result.host == "cdn.example.com"
    assert result.port == 443


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://localhost/admin",
        "http://127.0.0.1/admin",
        "http://10.0.0.1/audio",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/admin",
        "https://user:password@example.com/audio",
        "https://example.com:22/audio",
    ],
)
def test_unsafe_network_targets_are_rejected(url: str) -> None:
    with pytest.raises(UnsafeUrl):
        validate_outbound_url(url)


def test_provider_allowlist_is_case_insensitive() -> None:
    result = validate_outbound_url(
        "https://CDN.Example.com/audio",
        allowed_hosts={"cdn.example.com"},
    )

    assert result.host == "cdn.example.com"


def test_unknown_allowlisted_host_is_rejected() -> None:
    with pytest.raises(UnsafeUrl, match="allowlist"):
        validate_outbound_url(
            "https://other.example/audio",
            allowed_hosts={"cdn.example.com"},
        )
