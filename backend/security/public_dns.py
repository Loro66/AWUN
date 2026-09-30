"""Resolve outbound media hosts to public IPs at connection time."""

import asyncio
from ipaddress import ip_address
import socket

import aiohttp

from backend.security.safe_url import UnsafeUrl


def public_address_records(host: str, port: int, addresses: list[tuple]) -> list[dict]:
    records: list[dict] = []
    for family, _type, _proto, _name, endpoint in addresses:
        raw_ip = endpoint[0].split("%", 1)[0]
        try:
            public = ip_address(raw_ip).is_global
        except ValueError as exc:
            raise UnsafeUrl("Media host returned an invalid address") from exc
        if not public:
            raise UnsafeUrl("Media host resolved to a private or local address")
        records.append(
            {
                "hostname": host,
                "host": raw_ip,
                "port": port,
                "family": family,
                "proto": socket.IPPROTO_TCP,
                "flags": socket.AI_NUMERICHOST,
            }
        )
    if not records:
        raise UnsafeUrl("Media host did not resolve to a public address")
    return records


class PublicMediaResolver(aiohttp.abc.AbstractResolver):
    async def resolve(
        self, host: str, port: int = 0, family: socket.AddressFamily = socket.AF_UNSPEC
    ) -> list[dict]:
        try:
            addresses = await asyncio.get_running_loop().getaddrinfo(
                host, port, family=family, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP
            )
        except socket.gaierror as exc:
            raise UnsafeUrl("Media host could not be resolved") from exc
        return public_address_records(host, port, addresses)

    async def close(self) -> None:
        return None
