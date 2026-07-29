import pytest

from backend.analytics.events import AnalyticsEvent, EventName, anonymous_session_id


def test_session_id_is_stable_within_one_rotating_salt() -> None:
    first = anonymous_session_id("local-installation", daily_salt="2026-07-29")
    second = anonymous_session_id("local-installation", daily_salt="2026-07-29")
    next_day = anonymous_session_id("local-installation", daily_salt="2026-07-30")

    assert first == second
    assert first != next_day
    assert len(first) == 20


def test_event_drops_arbitrary_query_and_track_text() -> None:
    event = AnalyticsEvent.create(
        EventName.SEARCH_COMPLETED,
        session_id="anonymous",
        timestamp=100,
        properties={
            "source": "youtube",
            "result_count": 12,
            "query": "private search text",
            "track_title": "private title",
        },
    )

    assert event.properties == {"source": "youtube", "result_count": 12}
    assert "query" not in str(event.as_dict())


def test_values_are_bounded_before_serialization() -> None:
    event = AnalyticsEvent.create(
        EventName.PLAY_STARTED,
        session_id="anonymous",
        properties={"position": 99_999_999, "source": "x" * 200},
    )

    assert event.properties["position"] == 1_000_000
    assert len(str(event.properties["source"])) == 80


def test_event_serializes_enum_to_public_value() -> None:
    event = AnalyticsEvent.create(
        EventName.FLOW_STARTED,
        session_id="anonymous",
        timestamp=123,
    )

    assert event.as_dict()["name"] == "flow_started"
    assert event.as_dict()["timestamp"] == 123


@pytest.mark.parametrize("session_id", ["", "x" * 65])
def test_invalid_session_id_is_rejected(session_id: str) -> None:
    with pytest.raises(ValueError):
        AnalyticsEvent.create(EventName.TRACK_SAVED, session_id=session_id)
