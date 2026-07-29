"""Sanitize headers copied from provider metadata to outbound media requests."""

import re
from typing import Mapping


_ALLOWED = {
    "accept": "Accept",
    "accept-language": "Accept-Language",
    "origin": "Origin",
    "range": "Range",
    "referer": "Referer",
    "user-agent": "User-Agent",
}
_RANGE = re.compile(r"^bytes=\d*-\d*(?:,\d*-\d*)*$")
_DEFAULT_USER_AGENT = "AWUN/1.8 (+https://github.com/Loro66/AWUN)"


def _clean_value(value: object) -> str:
    text = str(value or "").strip()
    if "\r" in text or "\n" in text:
        return ""
    return text[:1024]


def sanitize_media_headers(
    headers: Mapping[str, object] | None,
    *,
    default_user_agent: str = _DEFAULT_USER_AGENT,
) -> dict[str, str]:
    """Keep only headers needed by CDNs and never forward credentials."""

    result: dict[str, str] = {}
    for raw_name, raw_value in (headers or {}).items():
        name = str(raw_name).strip().casefold()
        canonical = _ALLOWED.get(name)
        if not canonical:
            continue
        value = _clean_value(raw_value)
        if not value:
            continue
        if canonical == "Range" and not _RANGE.fullmatch(value):
            continue
        result[canonical] = value
    result.setdefault("User-Agent", _clean_value(default_user_agent) or _DEFAULT_USER_AGENT)
    return result


def response_headers_for_media(
    upstream: Mapping[str, object],
    *,
    attachment_filename: str | None = None,
) -> dict[str, str]:
    """Select safe response metadata without exposing upstream cookies or server data."""

    output: dict[str, str] = {}
    for name in ("Content-Type", "Content-Length", "Accept-Ranges", "Content-Range", "ETag"):
        value = _clean_value(upstream.get(name) or upstream.get(name.casefold()))
        if value:
            output[name] = value
    if attachment_filename:
        safe = attachment_filename.replace('"', "").replace("\\", "")[:180]
        output["Content-Disposition"] = f'attachment; filename="{safe}"'
    return output
