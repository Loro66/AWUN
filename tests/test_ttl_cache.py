import pytest

from backend.reliability.ttl_cache import TTLCache


class Clock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


def test_cache_returns_value_until_expiry() -> None:
    clock = Clock()
    cache = TTLCache[str, int](ttl_seconds=10, clock=clock)
    cache.set("answer", 42)

    assert cache.get("answer") == 42
    clock.now = 110
    assert cache.get("answer") is None
    assert cache.stats.hits == 1
    assert cache.stats.misses == 1


def test_lru_entry_is_evicted_at_capacity() -> None:
    cache = TTLCache[str, int](ttl_seconds=10, max_size=2)
    cache.set("first", 1)
    cache.set("second", 2)
    assert cache.get("first") == 1
    cache.set("third", 3)

    assert cache.get("second") is None
    assert list(cache.keys()) == ["first", "third"]
    assert cache.stats.evictions == 1


def test_pop_and_clear_are_explicit() -> None:
    cache = TTLCache[str, int](ttl_seconds=10)
    cache.set("one", 1)
    assert cache.pop("one") == 1
    assert cache.pop("missing") is None
    cache.set("two", 2)
    cache.clear()
    assert cache.stats.size == 0


@pytest.mark.parametrize("kwargs", [{"ttl_seconds": 0}, {"ttl_seconds": 1, "max_size": 0}])
def test_invalid_configuration_is_rejected(kwargs: dict[str, int]) -> None:
    with pytest.raises(ValueError):
        TTLCache(**kwargs)
