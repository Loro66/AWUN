"""Deterministically deduplicate a local library without deleting user data."""

from dataclasses import dataclass, field

from backend.core.models import Track
from backend.search.track_identity import identity_key, same_recording


@dataclass(slots=True)
class DuplicateGroup:
    primary: Track
    alternatives: list[Track] = field(default_factory=list)

    @property
    def all_tracks(self) -> tuple[Track, ...]:
        return (self.primary, *self.alternatives)


def _preference(track: Track) -> tuple[int, int, float, str]:
    """Prefer playable, downloadable and high-scoring metadata deterministically."""

    return (
        int(bool(track.stream_url)),
        int(bool(track.download_url)),
        track.score,
        track.id,
    )


def group_library_duplicates(tracks: list[Track]) -> list[DuplicateGroup]:
    """Group probable duplicates while preserving every provider alternative."""

    groups: list[DuplicateGroup] = []
    exact: dict[tuple[str, str, int], DuplicateGroup] = {}
    for track in tracks:
        key = identity_key(track)
        group = exact.get(key)
        if group is None:
            group = next(
                (
                    candidate
                    for candidate in groups
                    if same_recording(candidate.primary, track)
                ),
                None,
            )
        if group is None:
            group = DuplicateGroup(track)
            groups.append(group)
            exact[key] = group
            continue
        if _preference(track) > _preference(group.primary):
            group.alternatives.append(group.primary)
            group.primary = track
        else:
            group.alternatives.append(track)
        exact[key] = group

    for group in groups:
        group.alternatives.sort(key=_preference, reverse=True)
    return groups


def deduplicate_library(tracks: list[Track]) -> list[Track]:
    """Return preferred representatives; callers may retain groups for recovery."""

    return [group.primary for group in group_library_duplicates(tracks)]
