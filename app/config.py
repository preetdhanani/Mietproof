"""Env-backed settings with startup validation.

Validates at startup with actionable errors ("LLM_BASE_URL unset - see
.env.example"). Exposes separate generator and judge configurations, the
active collection (``ACTIVE_COLLECTION``), the retrieval backend
(``RETRIEVAL_BACKEND``), and the out-of-scope floor (``OUT_OF_SCOPE_FLOOR``).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent

RETRIEVAL_BACKENDS = ("bm25", "dense", "hybrid")


class LLMEndpointConfig(BaseSettings):
    """One OpenAI-compatible endpoint (generator or judge)."""

    base_url: str = ""
    model: str = ""
    api_key: str = ""

    def configured(self) -> bool:
        return bool(self.base_url and self.model)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Generator endpoint
    LLM_BASE_URL: str = ""
    LLM_MODEL: str = ""
    LLM_API_KEY: str = ""

    # Judge endpoint (separate entry; used only by the scheduled RAGAS tier)
    JUDGE_BASE_URL: str = ""
    JUDGE_MODEL: str = ""
    JUDGE_API_KEY: str = ""

    # Retrieval
    EMBEDDING_MODEL: str = "intfloat/multilingual-e5-base"
    RETRIEVAL_BACKEND: str = "dense"
    ACTIVE_COLLECTION: str = ""
    OUT_OF_SCOPE_FLOOR: float | None = None

    # Abuse protection
    DAILY_TOKEN_BUDGET: int = Field(default=200_000)
    RATE_LIMIT_PER_HOUR: int = Field(default=10)
    MAX_CONCURRENT_LLM: int = Field(default=3)

    # Langfuse tracing (self-hosted)
    LANGFUSE_HOST: str = ""
    LANGFUSE_PUBLIC_KEY: str = ""
    LANGFUSE_SECRET_KEY: str = ""

    # Corpus pin: which committed snapshot ingestion and evals read
    CORPUS_STAND: str = ""

    def generator(self) -> LLMEndpointConfig:
        return LLMEndpointConfig(
            base_url=self.LLM_BASE_URL, model=self.LLM_MODEL, api_key=self.LLM_API_KEY
        )

    def judge(self) -> LLMEndpointConfig:
        return LLMEndpointConfig(
            base_url=self.JUDGE_BASE_URL or self.LLM_BASE_URL,
            model=self.JUDGE_MODEL or self.LLM_MODEL,
            api_key=self.JUDGE_API_KEY or self.LLM_API_KEY,
        )

    @property
    def llm_configured(self) -> bool:
        return self.generator().configured()

    def validate_startup(self) -> None:
        """Fail with actionable errors before the app serves traffic."""
        if not self.LLM_BASE_URL:
            raise ValueError("LLM_BASE_URL unset - see .env.example")
        if not self.LLM_MODEL:
            raise ValueError("LLM_MODEL unset - see .env.example")
        if self.RETRIEVAL_BACKEND not in RETRIEVAL_BACKENDS:
            raise ValueError(
                f"RETRIEVAL_BACKEND={self.RETRIEVAL_BACKEND!r} invalid - "
                f"expected one of {RETRIEVAL_BACKENDS}"
            )
        if not self.ACTIVE_COLLECTION:
            raise ValueError("ACTIVE_COLLECTION unset - see .env.example")


@lru_cache
def get_settings() -> Settings:
    return Settings()
