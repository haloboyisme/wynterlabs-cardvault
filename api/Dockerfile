FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OPENCV_IO_MAX_IMAGE_PIXELS=20000000

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
        libxcb1 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1000 cards \
    && useradd --system --uid 1000 --gid cards --home-dir /app cards \
    && install -d -o cards -g cards /var/lib/wynterlabs/catalog-media

WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
COPY alembic.ini ./
COPY migrations ./migrations
RUN pip install .

USER cards
EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--no-server-header"]
