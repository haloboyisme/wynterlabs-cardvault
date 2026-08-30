"""Bounded local cache for approved third-party catalog images."""

import hashlib
import os
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from fcntl import LOCK_EX, LOCK_UN, flock
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import httpx

APPROVED_IMAGE_HOSTS = frozenset(
    {"cards.scryfall.io", "images.pokemontcg.io", "images.ygoprodeck.com", "tcgplayer-cdn.tcgplayer.com"}
)
IMAGE_TYPES = {
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
IMAGE_REQUEST_HEADERS = {
    "User-Agent": "WynterLabs-Cards/1.0 (+https://wynterlabs.com)",
    "Accept": "image/avif,image/webp,image/png,image/jpeg,*/*",
}


@dataclass(frozen=True)
class CachedImage:
    path: Path
    media_type: str


def _approved_source(source: str) -> str:
    parsed = urlsplit(source)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in APPROVED_IMAGE_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in (None, 443)
        or not parsed.path
    ):
        raise ValueError("Image source must use an approved catalog image host")
    scryfall_cache_buster = (
        parsed.hostname == "cards.scryfall.io" and parsed.query.isdigit()
    )
    if parsed.query and not scryfall_cache_buster:
        raise ValueError("Catalog image source must not contain a query")
    return urlunsplit(
        ("https", parsed.hostname, parsed.path, parsed.query if scryfall_cache_buster else "", "")
    )


def _cached(cache_dir: Path, digest: str) -> CachedImage | None:
    for media_type, suffix in IMAGE_TYPES.items():
        path = cache_dir / f"{digest}{suffix}"
        if path.is_file():
            path.touch()
            return CachedImage(path, media_type)
    return None


def _cache_files(cache_dir: Path) -> list[Path]:
    suffixes = frozenset(IMAGE_TYPES.values())
    return [
        path
        for path in cache_dir.iterdir()
        if path.is_file()
        and path.suffix in suffixes
        and len(path.stem) == 64
        and all(character in "0123456789abcdef" for character in path.stem)
    ]


@contextmanager
def _cache_lock(cache_dir: Path):
    with (cache_dir / ".cache.lock").open("a+b") as handle:
        flock(handle.fileno(), LOCK_EX)
        try:
            yield
        finally:
            flock(handle.fileno(), LOCK_UN)


def _make_room(cache_dir: Path, incoming_bytes: int, cache_max_bytes: int) -> None:
    if incoming_bytes > cache_max_bytes:
        raise ValueError("Catalog image exceeded the aggregate cache limit")
    files = _cache_files(cache_dir)
    total = sum(path.stat().st_size for path in files)
    for path in sorted(files, key=lambda item: item.stat().st_mtime_ns):
        if total + incoming_bytes <= cache_max_bytes:
            break
        size = path.stat().st_size
        path.unlink(missing_ok=True)
        total -= size


async def cache_remote_image(
    source: str,
    cache_dir: Path,
    max_bytes: int,
    cache_max_bytes: int,
    timeout_seconds: float,
    *,
    http_client: httpx.AsyncClient | None = None,
) -> CachedImage:
    """Return a cached image, downloading it once within strict safety bounds."""

    source = _approved_source(source)
    cache_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
    existing = _cached(cache_dir, digest)
    if existing is not None:
        return existing

    owns_client = http_client is None
    client = http_client or httpx.AsyncClient(
        timeout=httpx.Timeout(timeout_seconds), follow_redirects=False
    )
    temporary: Path | None = None
    try:
        async with client.stream(
            "GET", source, headers=IMAGE_REQUEST_HEADERS, follow_redirects=False
        ) as response:
            if response.status_code != 200:
                raise ValueError("Catalog image provider returned an unexpected status")
            media_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
            suffix = IMAGE_TYPES.get(media_type)
            if suffix is None:
                raise ValueError("Catalog image provider did not return an approved image type")
            content_length = response.headers.get("content-length")
            if content_length and int(content_length) > max_bytes:
                raise ValueError("Catalog image exceeded the configured size limit")
            descriptor, name = tempfile.mkstemp(prefix=f".{digest}-", dir=cache_dir)
            temporary = Path(name)
            size = 0
            with os.fdopen(descriptor, "wb") as handle:
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > max_bytes:
                        raise ValueError("Catalog image exceeded the configured size limit")
                    handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            destination = cache_dir / f"{digest}{suffix}"
            with _cache_lock(cache_dir):
                concurrent = _cached(cache_dir, digest)
                if concurrent is not None:
                    temporary.unlink(missing_ok=True)
                    temporary = None
                    return concurrent
                _make_room(cache_dir, size, cache_max_bytes)
                os.replace(temporary, destination)
                temporary = None
            return CachedImage(destination, media_type)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        if owns_client:
            await client.aclose()
