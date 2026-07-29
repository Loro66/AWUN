from backend.core.models import Track
from backend.search.ranking import RankingContext, order_tracks, rank_track


def make_track(
    title: str,
    *,
    artist: str = "Кино",
    duration: int = 280,
    score: float = 70,
    download: bool = False,
) -> Track:
    return Track(
        id=f"{artist}:{title}:{duration}",
        title=title,
        artist=artist,
        duration=duration,
        quality="192",
        source="internet_archive" if download else "youtube",
        stream_url="https://example.com/audio",
        download_url="https://example.com/audio" if download else None,
        score=score,
    )


def test_exact_title_and_artist_beat_high_upstream_noise() -> None:
    context = RankingContext(query="Кино Группа крови", artist="Кино", title="Группа крови")
    exact = make_track("Группа крови", score=55)
    noisy = make_track("Лучшие песни русского рока", artist="Various", score=99)

    assert rank_track(exact, context).score > rank_track(noisy, context).score
    assert order_tracks([noisy, exact], context)[0] is exact


def test_expected_duration_contributes_an_explainable_reason() -> None:
    result = rank_track(
        make_track("Dayvan Cowboy", artist="Boards of Canada", duration=302),
        RankingContext(
            query="Boards of Canada Dayvan Cowboy",
            artist="Boards of Canada",
            title="Dayvan Cowboy",
            expected_duration=300,
        ),
    )

    assert "title" in result.reasons
    assert "artist" in result.reasons
    assert "duration" in result.reasons


def test_download_preference_is_only_a_small_tiebreaker() -> None:
    context = RankingContext(query="rare track", prefer_downloadable=True)
    downloadable = make_track("Rare Track", artist="Artist", download=True)
    streaming = make_track("Rare Track", artist="Artist")

    assert rank_track(downloadable, context).score > rank_track(streaming, context).score
    assert "downloadable" in rank_track(downloadable, context).reasons


def test_ranking_does_not_mutate_upstream_score() -> None:
    item = make_track("Song", score=42)
    rank_track(item, RankingContext(query="song"))

    assert item.score == 42
