"""FastAPI application - the product surface.

Routes: ``POST /ask`` (the product endpoint), ``POST /ask/stream`` (the
same request as NDJSON pipeline-stage events, for the debug UI), ``GET /health`` (process
alive), ``GET /health/ready`` (names the failed dependency; an empty index
or an unreachable LLM fails readiness, while Langfuse being down is
reported in the response but does not fail readiness). Structured JSON logs
carry ``request_id``, which is attached to the Langfuse trace and returned
in error responses. Global exception handler maps upstream failures to
explicit 503s with a reason - never a silent empty answer.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.config import get_settings
from app.guardrails import (
    ConcurrencyFullError,
    LLMSemaphore,
    RateLimiter,
    TokenBudget,
)
from app.llm import LLMError, chat_completion
from app.pipeline import DISCLAIMER, Pipeline, load_floor
from app.trace import TraceCollector
from app.tracing import build_tracer
from retrieval.base import load_manifest
from retrieval.factory import build_retriever

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"

DISCLAIMER_TEXT = DISCLAIMER

_state: dict = {}


def _configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)

    class JsonFormatter(logging.Formatter):
        def format(self, record: logging.LogRecord) -> str:
            payload = {
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
                "request_id": getattr(record, "request_id", None),
            }
            return json.dumps(payload, ensure_ascii=False)

    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)


def _collections_root() -> Path:
    settings = get_settings()
    if settings.ACTIVE_COLLECTION and "/" in settings.ACTIVE_COLLECTION:
        return Path(settings.ACTIVE_COLLECTION).parent
    return DATA_DIR / "collections"


def _find_collection(name: str) -> Path:
    root = _collections_root()
    candidate = root / name
    if candidate.exists():
        return candidate
    # Also look under the repo-local default when an absolute path was given.
    raise FileNotFoundError(
        f"Collection {name!r} not found under {root}; run ingestion first "
        f"(make ingest) and set ACTIVE_COLLECTION={name!r}"
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    _configure_logging()
    settings = get_settings()
    _state["settings"] = settings
    _state["rate_limiter"] = RateLimiter(settings.RATE_LIMIT_PER_HOUR)
    _state["semaphore"] = LLMSemaphore(settings.MAX_CONCURRENT_LLM)
    _state["budget"] = TokenBudget(
        demo_budget=settings.DAILY_TOKEN_BUDGET,
        state_path=DATA_DIR / "token_budget_state.json",
    )
    _state["pipeline"] = None
    _state["pipeline_error"] = None
    _state["tracer"] = build_tracer(settings)
    try:
        _state["pipeline"] = _build_pipeline(settings)
    except Exception as exc:  # surfaced via /health/ready, not a crash loop
        logger.error("pipeline init failed: %s", exc)
        _state["pipeline_error"] = str(exc)
    yield
    tracer = _state.get("tracer")
    if tracer is not None:
        tracer.flush()


def _build_pipeline(settings) -> Pipeline:
    collection_dir = _find_collection(settings.ACTIVE_COLLECTION)
    manifest = load_manifest(collection_dir)
    retriever = build_retriever(collection_dir, settings)
    prompts = {
        name: (REPO_ROOT / "app" / "prompts" / name).read_text(encoding="utf-8")
        for name in ("answer.md", "rewrite.md")
    }
    floor = settings.OUT_OF_SCOPE_FLOOR
    if floor is None:
        floor = load_floor()
        if floor is None:
            logger.warning(
                "no out-of-scope floor configured (OUT_OF_SCOPE_FLOOR unset, "
                "evals/baselines/floor.json missing) - floor check bypassed"
            )
    return Pipeline(
        retriever=retriever,
        generator=settings.generator(),
        answer_prompt=prompts["answer.md"],
        rewrite_prompt=prompts["rewrite.md"],
        paragraphs=_load_paragraphs(collection_dir),
        stand_date=manifest["stand_date"],
        laws=manifest.get("laws", ["BGB"]),
        floor=floor,
    )


def _load_paragraphs(collection_dir: Path) -> dict[str, dict]:
    from retrieval.base import load_paragraphs

    return load_paragraphs(collection_dir)


app = FastAPI(
    title="BGB Rental Law RAG Assistant",
    description=(
        "Question answering over German rental law (BGB §§ 535-580a) in "
        "English, with paragraph-level citations to gesetze-im-internet.de. "
        "General statutory information only - not legal advice."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# The debug UI may be served from a different origin (Caddy site or dev server).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # no auth, public read-only demo
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    session_id: str | None = None
    debug: bool = False  # include the full pipeline trace (for the debug UI)


class CitationOut(BaseModel):
    index: int
    paragraph: str
    absatz: str
    law_abbr: str
    german_text: str
    gloss_en: str
    deep_link: str


class AskResponse(BaseModel):
    answer: str
    citations: list[CitationOut]
    disclaimer: str
    corpus_stand_date: str
    request_id: str
    behavior: str
    gap_note: str | None = None
    trace: dict | None = None  # pipeline trace when debug=true


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _prompt_version() -> str:
    """Hash of the versioned prompt artifacts (same scheme as the run log)."""
    import hashlib

    hasher = hashlib.sha256()
    prompts = REPO_ROOT / "app" / "prompts"
    for path in sorted(prompts.glob("*.md")):
        hasher.update(path.name.encode())
        hasher.update(path.read_bytes())
    return hasher.hexdigest()[:12]


def _admit(request: Request, request_id: str) -> Pipeline:
    """Guardrails shared by /ask and /ask/stream. Raises the HTTP error
    before any response (or stream) starts."""
    ip = _client_ip(request)
    limiter: RateLimiter = _state["rate_limiter"]
    if not limiter.allow(ip):
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate limit exceeded",
                "retry_after_seconds": limiter.retry_after(ip),
                "request_id": request_id,
            },
        )

    budget: TokenBudget = _state["budget"]
    if not budget.can_spend(0):
        raise HTTPException(
            status_code=429,
            detail={
                "error": "daily token budget exhausted",
                "resets_at": budget.reset_time(),
                "request_id": request_id,
            },
        )

    pipeline: Pipeline | None = _state.get("pipeline")
    if pipeline is None:
        raise HTTPException(
            status_code=503,
            detail={"error": "index not loaded", "request_id": request_id},
        )
    return pipeline


def _trace_meta() -> dict:
    """Static configuration shown in the debug UI next to every trace."""
    settings = _state["settings"]
    return {
        "llm_model": settings.LLM_MODEL,
        "retrieval_backend": settings.RETRIEVAL_BACKEND,
        "embedding_model": settings.EMBEDDING_MODEL,
        "collection": settings.ACTIVE_COLLECTION,
        "prompt_version": _prompt_version(),
    }


async def _run_pipeline(
    pipeline: Pipeline,
    payload: AskRequest,
    request_id: str,
    collector: TraceCollector | None,
) -> AskResponse:
    """Run one request through the pipeline off the event loop, then log,
    record token spend, and trace it.

    The concurrency slot is released when the worker thread finishes, not
    when the caller goes away: a disconnected stream client must not free a
    slot while its LLM call is still running.
    """
    semaphore: LLMSemaphore = _state["semaphore"]
    try:
        await semaphore.acquire()
    except ConcurrencyFullError:
        raise HTTPException(
            status_code=429,
            detail={"error": "server busy, retry shortly", "request_id": request_id},
        ) from None

    started = time.monotonic()
    worker = asyncio.ensure_future(
        asyncio.to_thread(
            pipeline.ask,
            payload.question,
            session_id=payload.session_id,
            request_id=request_id,
            now=time.time(),
            collector=collector,
        )
    )
    worker.add_done_callback(lambda _: semaphore.release())
    try:
        result = await asyncio.shield(worker)
    except LLMError as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": f"LLM endpoint unavailable: {exc}", "request_id": request_id},
        ) from exc

    latency_ms = int((time.monotonic() - started) * 1000)
    logger.info(
        "ask handled",
        extra={
            "request_id": request_id,
            "latency_ms": latency_ms,
            "behavior": result.behavior,
        },
    )
    tokens = result.usage.get("total_tokens", 0)
    if tokens:
        _state["budget"].record(tokens)
    tracer = _state.get("tracer")
    if tracer is not None:
        await asyncio.to_thread(
            tracer.trace_request,
            request_id=request_id,
            question=payload.question,
            answer=result.answer,
            behavior=result.behavior,
            retrieved=result.retrieved,
            citations=result.citations,
            latency_ms=latency_ms,
            model=_state["settings"].LLM_MODEL,
            prompt_version=_prompt_version(),
        )
    trace = None
    if collector is not None:
        trace = collector.to_json()
        trace["usage"] = result.usage
    return AskResponse(
        answer=result.answer,
        citations=[asdict_citation(c) for c in result.citations],
        disclaimer=DISCLAIMER_TEXT,
        corpus_stand_date=result.stand_date,
        request_id=request_id,
        behavior=result.behavior,
        gap_note=result.gap_note,
        trace=trace,
    )


@app.post("/ask", response_model=AskResponse)
async def ask(payload: AskRequest, request: Request) -> AskResponse:
    request_id = uuid.uuid4().hex[:12]
    pipeline = _admit(request, request_id)
    collector = (
        TraceCollector(request_id=request_id, question=payload.question, meta=_trace_meta())
        if payload.debug
        else None
    )
    return await _run_pipeline(pipeline, payload, request_id, collector)


@app.post("/ask/stream")
async def ask_stream(payload: AskRequest, request: Request) -> StreamingResponse:
    """Same as /ask with debug=true, streamed as NDJSON so a client can show
    each pipeline stage the moment it finishes.

    Events, one JSON object per line: ``{"type": "start", ...}``, then
    ``{"type": "stage", "stage": {...}}`` per stage, while the LLM writes
    ``{"type": "llm_start", "attempt": n}`` and batched
    ``{"type": "delta", "attempt": n, "kind": "reasoning" | "content", "text": ...}``
    (an unverified draft - the UI must not present it as the answer), then exactly one of
    ``{"type": "result", "response": {...}}`` or
    ``{"type": "error", "status": ..., "error": ..., "request_id": ...}``.
    Rate-limit, budget and index failures are plain HTTP errors before the
    stream opens; failures after that (busy LLM slot, LLM down) arrive as an
    ``error`` event.
    """
    request_id = uuid.uuid4().hex[:12]
    pipeline = _admit(request, request_id)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict] = asyncio.Queue()
    collector = TraceCollector(
        request_id=request_id,
        question=payload.question,
        meta=_trace_meta(),
        listener=lambda event: loop.call_soon_threadsafe(queue.put_nowait, event),
    )

    async def run() -> None:
        try:
            response = await _run_pipeline(pipeline, payload, request_id, collector)
            event = {"type": "result", "response": response.model_dump()}
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {"error": str(exc.detail)}
            event = {"type": "error", "status": exc.status_code, **detail}
        except Exception:  # noqa: BLE001 - reported to the client, never a hung stream
            logger.exception("stream request failed", extra={"request_id": request_id})
            event = {
                "type": "error",
                "status": 500,
                "error": "internal error",
                "request_id": request_id,
            }
        queue.put_nowait(event)

    async def events() -> AsyncIterator[str]:
        yield _ndjson({"type": "start", "request_id": request_id, "meta": collector.meta})
        task = asyncio.create_task(run())
        try:
            while True:
                event = await queue.get()
                yield _ndjson(event)
                if event["type"] in ("result", "error"):
                    break
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _ndjson(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False) + "\n"


def asdict_citation(citation: dict) -> dict:
    """Normalize both citation shapes (verified citations and the refusal
    path's nearest-paragraphs) to the response schema."""
    return {
        "index": citation.get("index", 0),
        "paragraph": citation["paragraph"],
        "absatz": citation.get("absatz", ""),
        "law_abbr": citation.get("law_abbr", "BGB"),
        "german_text": citation.get("german_text", citation.get("chunk_text", "")),
        "gloss_en": citation.get("gloss_en", ""),
        "deep_link": citation.get(
            "deep_link",
            f"https://www.gesetze-im-internet.de/bgb/__{citation['paragraph']}.html",
        ),
    }


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready(request: Request) -> JSONResponse:
    pipeline = _state.get("pipeline")
    dependencies = {}
    ready = True
    if pipeline is None:
        dependencies["index"] = _state.get("pipeline_error") or "index not loaded"
        ready = False
    else:
        generator = _state["settings"].generator()
        try:
            chat_completion(generator, messages=[{"role": "user", "content": "ping"}], max_tokens=1)
            dependencies["llm"] = "ok"
        except LLMError as exc:
            dependencies["llm"] = f"unreachable: {exc}"
            ready = False
    try:
        import httpx

        host = _state["settings"].LANGFUSE_HOST
        if host:
            response = httpx.get(host.rstrip("/") + "/api/public/health", timeout=5)
            status_code = response.status_code
            dependencies["langfuse"] = "ok" if status_code == 200 else f"status {status_code}"
        else:
            dependencies["langfuse"] = "not configured"
    except Exception as exc:  # noqa: BLE001 - reported, never fatal
        dependencies["langfuse"] = f"unreachable: {exc}"

    status = "ok" if ready else "degraded"
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": status, "dependencies": dependencies},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = uuid.uuid4().hex[:12]
    logger.exception("unhandled error", extra={"request_id": request_id})
    return JSONResponse(
        status_code=500,
        content={"error": "internal error", "request_id": request_id},
    )
