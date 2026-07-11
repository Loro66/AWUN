from abc import ABC, abstractmethod

from backend.core.models import SourceName, Track


class AdapterError(RuntimeError):
    """A recoverable source-specific search failure."""


class BaseAdapter(ABC):
    @property
    @abstractmethod
    def source(self) -> SourceName:
        raise NotImplementedError

    @abstractmethod
    async def search(self, query: str, limit: int) -> list[Track]:
        """Return up to ``limit`` results without downloading media."""
        raise NotImplementedError

    async def close(self) -> None:
        """Release adapter resources when the app shuts down."""

