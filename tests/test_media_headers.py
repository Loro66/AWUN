from backend.security.media_headers import response_headers_for_media, sanitize_media_headers


def test_only_allowlisted_request_headers_survive() -> None:
    result = sanitize_media_headers(
        {
            "Referer": "https://provider.example/",
            "Range": "bytes=0-1023",
            "Cookie": "session=secret",
            "Authorization": "Bearer secret",
            "X-Forwarded-For": "127.0.0.1",
        }
    )

    assert result["Referer"] == "https://provider.example/"
    assert result["Range"] == "bytes=0-1023"
    assert "Cookie" not in result
    assert "Authorization" not in result
    assert "User-Agent" in result


def test_header_injection_and_invalid_range_are_removed() -> None:
    result = sanitize_media_headers(
        {
            "Origin": "https://safe.example\r\nX-Evil: yes",
            "Range": "items=0-1",
        }
    )

    assert "Origin" not in result
    assert "Range" not in result


def test_response_headers_exclude_upstream_server_metadata() -> None:
    result = response_headers_for_media(
        {
            "Content-Type": "audio/mpeg",
            "Content-Length": "1234",
            "Set-Cookie": "secret",
            "Server": "internal",
        }
    )

    assert result == {"Content-Type": "audio/mpeg", "Content-Length": "1234"}


def test_attachment_filename_is_sanitized() -> None:
    result = response_headers_for_media({}, attachment_filename='Artist - "Song"\\demo.mp3')

    assert result["Content-Disposition"] == 'attachment; filename="Artist - Songdemo.mp3"'
