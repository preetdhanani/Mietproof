# Application image - code only. No index is baked in:
# collections live on a mounted volume (app-data), selected by ACTIVE_COLLECTION.
FROM python:3.12-slim

WORKDIR /app

# uv for fast, lockfile-exact installs
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .
RUN uv sync --frozen --no-dev

EXPOSE 8000

CMD ["uv", "run", "--no-dev", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
