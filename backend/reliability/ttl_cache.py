"""A small bounded TTL cache with deterministic expiry semantics."""

from collections import OrderedDict
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from time import monotonic
from typing import Generic, TypeVar


Key = TypeVar("Key")
Value = TypeVar("Value")


@dataclass(frozen=True, slots=True)
class CacheStats:
    size: int
    hits: int
    misses: int
    evictions: int


class TTLCache(Generic[Key, Value]):
    def __init__(
        self,
        *,
        ttl_seconds: float,
        max_size: int = 256,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        if max_size < 1:
            raise ValueError("max_size must be positive")
        self._ttl = ttl_seconds
        self._max_size = max_size
        self._clock = clock
        self._items: OrderedDict[Key, tuple[float, Value]] = OrderedDict()
        self._hits = 0
        self._misses = 0
        self._evictions = 0

    def set(self, key: Key, value: Value) -> None:
        expires_at = self._clock() + self._ttl
        self._items.pop(key, None)
        self._items[key] = (expires_at, value)
        while len(self._items) > self._max_size:
            self._items.popitem(last=False)
            self._evictions += 1

    def get(self, key: Key, default: Value | None = None) -> Value | None:
        item = self._items.get(key)
        if item is None:
            self._misses += 1
            return default
        expires_at, value = item
        if expires_at <= self._clock():
            self._items.pop(key, None)
            self._misses += 1
            return default
        self._items.move_to_end(key)
        self._hits += 1
        return value

    def pop(self, key: Key) -> Value | None:
        item = self._items.pop(key, None)
        return item[1] if item else None

    def purge_expired(self) -> int:
        now = self._clock()
        expired = [key for key, (expires_at, _) in self._items.items() if expires_at <= now]
        for key in expired:
            self._items.pop(key, None)
        return len(expired)

    def keys(self) -> Iterator[Key]:
        self.purge_expired()
        return iter(tuple(self._items))

    def clear(self) -> None:
        self._items.clear()

    @property
    def stats(self) -> CacheStats:
        self.purge_expired()
        return CacheStats(len(self._items), self._hits, self._misses, self._evictions)
