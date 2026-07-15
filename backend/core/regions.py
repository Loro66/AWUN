from dataclasses import dataclass
from typing import Literal, cast


RegionName = Literal["AUTO", "CIS", "EUROPE", "USA", "LATAM", "ASIA", "GLOBAL"]
REGION_NAMES: tuple[RegionName, ...] = (
    "AUTO",
    "CIS",
    "EUROPE",
    "USA",
    "LATAM",
    "ASIA",
    "GLOBAL",
)


@dataclass(frozen=True, slots=True)
class RegionProfile:
    name: RegionName
    country: str | None
    language: str | None
    alias_locales: tuple[str, ...]
    apple_storefront: str


_PROFILES: dict[RegionName, RegionProfile] = {
    "CIS": RegionProfile("CIS", "RU", "ru", ("ru", "uk", "be", "kk"), "us"),
    "EUROPE": RegionProfile("EUROPE", "DE", "en", ("en", "de", "fr", "es", "it", "pl"), "de"),
    "USA": RegionProfile("USA", "US", "en", ("en",), "us"),
    "LATAM": RegionProfile("LATAM", "MX", "es", ("es", "pt"), "mx"),
    "ASIA": RegionProfile("ASIA", "JP", "ja", ("ja", "ko", "zh", "hi", "en"), "jp"),
    "GLOBAL": RegionProfile("GLOBAL", None, None, (), "us"),
}

_CIS = {"AM", "AZ", "BY", "GE", "KZ", "KG", "MD", "RU", "TJ", "TM", "UA", "UZ"}
_LATAM = {
    "AR", "BO", "BR", "BZ", "CL", "CO", "CR", "CU", "DO", "EC", "GT", "HN",
    "MX", "NI", "PA", "PE", "PR", "PY", "SV", "UY", "VE",
}
_ASIA = {
    "BD", "CN", "HK", "ID", "IN", "JP", "KH", "KR", "LA", "LK", "MM", "MY",
    "NP", "PH", "PK", "SG", "TH", "TW", "VN",
}
_EUROPE = {
    "AL", "AT", "BE", "BG", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
    "FR", "GB", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV",
    "MC", "ME", "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "SE", "SI", "SK",
}


def resolve_region(name: RegionName, locale: str | None = None) -> RegionProfile:
    if name != "AUTO":
        return _PROFILES[name]

    language, _, country = (locale or "").replace("_", "-").partition("-")
    language = language.lower() or None
    country = country.upper() or None
    if country in _CIS or language in {"ru", "uk", "be", "kk"}:
        base = _PROFILES["CIS"]
    elif country in _LATAM or language in {"es", "pt"}:
        base = _PROFILES["LATAM"]
    elif country in _ASIA or language in {"ja", "ko", "zh", "hi", "id", "vi", "th"}:
        base = _PROFILES["ASIA"]
    elif country == "US":
        base = _PROFILES["USA"]
    elif country in _EUROPE:
        base = _PROFILES["EUROPE"]
    else:
        base = _PROFILES["GLOBAL"]

    return RegionProfile(
        name="AUTO",
        country=country or base.country,
        language=language or base.language,
        alias_locales=base.alias_locales,
        apple_storefront=(country or base.apple_storefront).lower(),
    )


def normalize_region(value: str) -> RegionName:
    normalized = value.strip().upper()
    if normalized not in REGION_NAMES:
        raise ValueError(f"region must be one of: {', '.join(REGION_NAMES)}")
    return cast(RegionName, normalized)
