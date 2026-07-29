import pytest

from backend.security.signed_cursor import CursorSigner, InvalidCursor, query_fingerprint


class Clock:
    def __init__(self) -> None:
        self.now = 1000

    def __call__(self) -> float:
        return self.now


def test_cursor_round_trip_is_bound_to_normalized_query() -> None:
    clock = Clock()
    signer = CursorSigner("sixteen-character-secret", ttl_seconds=60, clock=clock)
    token = signer.encode(query="  Кино   Группа крови ", offset=30)

    payload = signer.decode(token, query="кино группа крови")
    assert payload.offset == 30
    assert payload.query_hash == query_fingerprint("Кино Группа крови")
    assert payload.expires_at == 1060


def test_cursor_cannot_be_reused_for_another_query() -> None:
    signer = CursorSigner("sixteen-character-secret")
    token = signer.encode(query="first", offset=10)

    with pytest.raises(InvalidCursor, match="another query"):
        signer.decode(token, query="second")


def test_modified_cursor_is_rejected() -> None:
    signer = CursorSigner("sixteen-character-secret")
    token = signer.encode(query="song", offset=10)
    replacement = "A" if token[-1] != "A" else "B"

    with pytest.raises(InvalidCursor):
        signer.decode(token[:-1] + replacement, query="song")


def test_expired_cursor_is_rejected() -> None:
    clock = Clock()
    signer = CursorSigner("sixteen-character-secret", ttl_seconds=30, clock=clock)
    token = signer.encode(query="song", offset=10)
    clock.now = 1031

    with pytest.raises(InvalidCursor, match="expired"):
        signer.decode(token, query="song")


def test_invalid_signer_configuration_is_rejected() -> None:
    with pytest.raises(ValueError):
        CursorSigner("short")
    with pytest.raises(ValueError):
        CursorSigner("sixteen-character-secret", ttl_seconds=5)
