"""Validate outbound media URLs before the proxy opens a connection."""

from dataclasses import dataclass
from ipaddress import ip_address
from urllib.parse import SplitResult, urlsplit, urlunsplit


class UnsafeUrl(ValueError):
    """Raised when an outbound URL crosses AWUN's network boundary."""


@dataclass(frozen=True, slots=True)
class ValidatedUrl:
    url: str
    host: str
    scheme: str
    port: int


def _is_forbidden_ip(host: str) -> bool:
    try:
        address = ip_address(host.strip("[]"))
    except ValueError:
        return False
    return any(
        (
            address.is_private,
            address.is_loopback,
            address.is_link_local,
            address.is_multicast,
            address.is_reserved,
            address.is_unspecified,
        )
    )


def validate_outbound_url(
    value: str,
    *,
    allowed_hosts: set[str] | None = None,
    allowed_ports: set[int] = frozenset({80, 443}),
) -> ValidatedUrl:
    """Accept public HTTP(S) URLs and reject common SSRF targets."""

    if len(value) > 4096:
        raise UnsafeUrl("URL is too long")
    try:
        parts: SplitResult = urlsplit(value)
        port = parts.port
    except ValueError as exc:
        raise UnsafeUrl("URL is malformed") from exc
    if parts.scheme.casefold() not in {"http", "https"}:
        raise UnsafeUrl("Only HTTP and HTTPS are allowed")
    if parts.username or parts.password:
        raise UnsafeUrl("Credentials in URLs are not allowed")
    host = (parts.hostname or "").rstrip(".").casefold()
    if not host:
        raise UnsafeUrl("URL host is required")
    if host == "localhost" or host.endswith(".localhost") or _is_forbidden_ip(host):
        raise UnsafeUrl("Local and private hosts are not allowed")
    if allowed_hosts is not None and host not in {item.casefold() for item in allowed_hosts}:
        raise UnsafeUrl("Host is not in the provider allowlist")
    resolved_port = port or (443 if parts.scheme.casefold() == "https" else 80)
    if resolved_port not in allowed_ports:
        raise UnsafeUrl("URL port is not allowed")

    normalized = urlunsplit(
        (
            parts.scheme.casefold(),
            parts.netloc,
            parts.path or "/",
            parts.query,
            "",
        )
    )
    return ValidatedUrl(normalized, host, parts.scheme.casefold(), resolved_port)
