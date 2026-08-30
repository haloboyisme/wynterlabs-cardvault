import asyncio

import httpx
import pytest

from app.catalog.media import _approved_source, cache_remote_image


def test_caches_allowed_pokemon_image_and_reuses_local_copy(tmp_path):
    async def exercise():
        calls = 0

        async def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=b"jpeg-data")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            first = await cache_remote_image(
                "https://images.pokemontcg.io/base1/4_hires.png",
                tmp_path,
                1024,
                4096,
                2,
                http_client=client,
            )
            second = await cache_remote_image(
                "https://images.pokemontcg.io/base1/4_hires.png",
                tmp_path,
                1024,
                4096,
                2,
                http_client=client,
            )
        assert first == second
        assert first.path.read_bytes() == b"jpeg-data"
        assert first.media_type == "image/jpeg"
        assert calls == 1

    asyncio.run(exercise())


def test_caches_allowed_scryfall_image(tmp_path):
    async def exercise():
        async def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, headers={"content-type": "image/png"}, content=b"png")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            cached = await cache_remote_image(
                "https://cards.scryfall.io/normal/front/a/b/card.png",
                tmp_path,
                1024,
                4096,
                2,
                http_client=client,
            )
        assert cached.path.read_bytes() == b"png"
        assert cached.media_type == "image/png"

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "source",
    [
        "http://images.pokemontcg.io/base1/4.png",
        "https://images.pokemontcg.io.evil.test/card.png",
        "https://user:member-8c17a6961211@example.invalid/card.jpg",
        "https://192.0.2.57/card.jpg",
    ],
)
def test_rejects_unsafe_sources_before_network(tmp_path, source):
    async def exercise():
        async def handler(_request: httpx.Request) -> httpx.Response:
            raise AssertionError("unsafe source reached the network")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with pytest.raises(ValueError, match="approved catalog image host"):
                await cache_remote_image(source, tmp_path, 1024, 4096, 2, http_client=client)

    asyncio.run(exercise())


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (httpx.Response(302, headers={"location": "https://192.0.2.142/private"}), "status"),
        (httpx.Response(200, headers={"content-type": "text/html"}, content=b"no"), "image"),
        (httpx.Response(200, headers={"content-type": "image/png"}, content=b"x" * 9), "size"),
    ],
)
def test_rejects_redirects_non_images_and_oversized_downloads(tmp_path, response, message):
    async def exercise():
        async def handler(_request: httpx.Request) -> httpx.Response:
            return response

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler), follow_redirects=False
        ) as client:
            with pytest.raises(ValueError, match=message):
                await cache_remote_image(
                    "https://images.ygoprodeck.com/images/cards/1.jpg",
                    tmp_path,
                    8,
                    64,
                    2,
                    http_client=client,
                )
        assert not list(tmp_path.glob("*"))

    asyncio.run(exercise())


def test_preserves_scryfall_numeric_cache_busters(tmp_path):
    async def exercise():
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            assert str(request.url) == "https://cards.scryfall.io/normal/card.jpg?1783944234"
            assert request.headers["user-agent"].startswith("WynterLabs-Cards/")
            assert "image/jpeg" in request.headers["accept"]
            return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=b"card")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            first = await cache_remote_image(
                "https://cards.scryfall.io/normal/card.jpg?1783944234",
                tmp_path,
                1024,
                4096,
                2,
                http_client=client,
            )
            second = await cache_remote_image(
                "https://cards.scryfall.io/normal/card.jpg?1783944234",
                tmp_path,
                1024,
                4096,
                2,
                http_client=client,
            )
        assert first.path == second.path
        assert calls == 1

    asyncio.run(exercise())


def test_accepts_one_piece_tcgplayer_cdn_image_source():
    assert _approved_source(
        "https://tcgplayer-cdn.tcgplayer.com/product/454512_in_1000x1000.jpg"
    ) == "https://tcgplayer-cdn.tcgplayer.com/product/454512_in_1000x1000.jpg"


def test_accepts_digimon_reference_image_source():
    assert _approved_source(
        "https://images.digimoncard.io/images/cards/BT19-044.webp"
    ) == "https://images.digimoncard.io/images/cards/BT19-044.webp"


def test_rejects_non_numeric_provider_queries(tmp_path):
    async def exercise():
        with pytest.raises(ValueError, match="query"):
            await cache_remote_image(
                "https://cards.scryfall.io/normal/card.jpg?duplicate=1",
                tmp_path,
                1024,
                4096,
                2,
            )

    asyncio.run(exercise())


def test_evicts_oldest_cached_image_to_enforce_aggregate_limit(tmp_path):
    async def exercise():
        async def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                headers={"content-type": "image/jpeg"},
                content=request.url.path.encode()[-6:],
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            first = await cache_remote_image(
                "https://cards.scryfall.io/normal/first-card.jpg",
                tmp_path,
                1024,
                10,
                2,
                http_client=client,
            )
            second = await cache_remote_image(
                "https://cards.scryfall.io/normal/second-card.jpg",
                tmp_path,
                1024,
                10,
                2,
                http_client=client,
            )
        assert not first.path.exists()
        assert second.path.exists()
        assert sum(path.stat().st_size for path in tmp_path.iterdir()) <= 10

    asyncio.run(exercise())
