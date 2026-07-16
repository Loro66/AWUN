from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.core.regions import RegionName, normalize_region


SourceName = Literal["youtube", "soundcloud", "audius", "jamendo", "internet_archive"]


class Track(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    id: str
    title: str
    artist: str
    duration: int = Field(default=0, ge=0)
    quality: str
    source: SourceName
    stream_url: str
    download_url: str | None = None
    score: float = Field(ge=0, le=100)
    thumbnail: str | None = None
    catalog_links: dict[str, str] = Field(default_factory=dict)
    request_headers: dict[str, str] = Field(default_factory=dict, exclude=True)


class SearchRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    query: str = Field(min_length=1, max_length=200)
    limit: int = Field(default=30, ge=1, le=100)
    sources: list[SourceName] | None = None
    region: RegionName = "AUTO"
    locale: str | None = Field(default=None, max_length=35, pattern=r"^[A-Za-z]{2,3}(?:[-_][A-Za-z]{2,4})?$")

    @field_validator("sources")
    @classmethod
    def unique_sources(cls, value: list[SourceName] | None) -> list[SourceName] | None:
        return list(dict.fromkeys(value)) if value else None

    @field_validator("region", mode="before")
    @classmethod
    def valid_region(cls, value: str) -> RegionName:
        return normalize_region(value)


class SearchResponse(BaseModel):
    query: str
    tracks: list[Track]
    total: int = Field(ge=0)
    searched_sources: list[SourceName]
    region: RegionName
    query_variants: list[str] = Field(default_factory=list)
    errors: dict[str, str] = Field(default_factory=dict)
    elapsed_ms: int = Field(ge=0)


class TrackAnnotation(BaseModel):
    id: str
    text: str
    source: Literal["genius"] = "genius"
    author: str | None = None
    url: str | None = None
    votes: int = 0


class LyricLine(BaseModel):
    index: int = Field(ge=0)
    time: float | None = Field(default=None, ge=0)
    text: str
    annotations: list[TrackAnnotation] = Field(default_factory=list)


class TrackDetailsResponse(BaseModel):
    artist: str
    title: str
    lyrics_source: Literal["lrclib"] | None = None
    synced: bool = False
    lines: list[LyricLine] = Field(default_factory=list)
    genius_url: str | None = None
    genius_enabled: bool = False
    message: str | None = None
