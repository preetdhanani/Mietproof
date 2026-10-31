"""End-to-end pipeline flow with a stubbed LLM: follow-up rewriting invoked,
out-of-scope floor triggers the covered-topics response, German input
produces the designed English response, disclaimer and Stand date present
in every response, and a below-floor case triggers the out-of-scope response."""

from __future__ import annotations

from pathlib import Path

import pytest

from app import pipeline as pipeline_module
from app.pipeline import (
    DISCLAIMER,
    Pipeline,
    SessionStore,
    looks_german,
)
from app.rewriting import is_follow_up
from retrieval.dense import DenseRetriever
from tests.conftest import STAND_DATE

FIXTURE = Path(__file__).parent / "fixtures" / "collection"

GOOD_ANSWER = (
    "The tenancy ends when the agreed term expires [1]. "
    'The statute says "endet mit dem Ablauf dieser Zeit" [2]. '
    'It also says "nach den gesetzlichen Vorschriften kündigen" [2].'
)


@pytest.fixture
def retriever():
    from sentence_transformers import SentenceTransformer

    from ingestion.embed import Embedder

    wrapper = Embedder.__new__(Embedder)  # skip __init__ (no model reload)
    wrapper.model_name = "intfloat/multilingual-e5-base"
    wrapper._model = SentenceTransformer("intfloat/multilingual-e5-base")
    return DenseRetriever(FIXTURE, model=wrapper)


def make_pipeline(
    retriever, floor: float | None = 0.5, responses: list[str] | None = None
) -> tuple[Pipeline, list]:
    """Build a Pipeline whose LLM calls go through a stub, recorded."""
    calls: list = []

    def fake_chat_completion(endpoint, messages, **kwargs):
        calls.append({"messages": messages, **kwargs})
        content = responses[min(len(calls) - 1, len(responses) - 1)]
        return {"choices": [{"message": {"content": content}}]}

    pipe = Pipeline(
        retriever=retriever,
        generator=None,  # unused; _generate is replaced below
        answer_prompt="ANSWER PROMPT",
        rewrite_prompt="REWRITE PROMPT",
        paragraphs=pipeline_module_load_paragraphs(FIXTURE),
        stand_date=STAND_DATE,
        laws=["BGB"],
        floor=floor,
    )

    def fake_generate(prompt, on_delta=None):
        content = fake_chat_completion(None, [{"role": "user", "content": prompt}])["choices"][0][
            "message"
        ]["content"]
        if on_delta is not None:  # stream it like the real endpoint would
            on_delta("reasoning", "thinking")
            on_delta("content", content)
        return content, {}

    pipe._generate = fake_generate  # type: ignore[method-assign]
    pipe._rewrite = None
    return pipe, calls


def pipeline_module_load_paragraphs(collection: Path) -> dict[str, dict]:
    from retrieval.base import load_paragraphs

    return load_paragraphs(collection)


def test_disclaimer_and_stand_date_in_answer_response(retriever) -> None:
    pipe, _calls = make_pipeline(retriever, responses=[GOOD_ANSWER])
    result = pipe.ask("What happens when the lease ends?", request_id="r1")
    assert result.behavior == "answer"
    assert result.stand_date == STAND_DATE
    assert result.citations, "citations must be present"
    assert result.citations[0]["deep_link"].startswith("https://www.gesetze-im-internet.de/")


def test_disclaimer_constant_is_not_legal_advice() -> None:
    assert "not legal advice" in DISCLAIMER


def test_german_input_gets_fixed_template(retriever) -> None:
    pipe, calls = make_pipeline(retriever, responses=[GOOD_ANSWER])
    result = pipe.ask("Wie viel Kündigung muss ich bei meiner Wohnung einhalten?", request_id="r2")
    assert result.behavior == "german_input"
    assert "English" in result.answer
    assert "gesetze-im-internet.de" in result.answer
    assert calls == [], "no LLM call for German input"


def test_looks_german_heuristic() -> None:
    assert looks_german("Muss ich die Wohnung fristgerecht kündigen?")
    assert not looks_german("How much notice must I give?")


def test_out_of_scope_floor_triggers_covered_topics(retriever) -> None:
    # Floor of 1.0 forces every query below the floor.
    pipe, calls = make_pipeline(retriever, floor=1.0, responses=[GOOD_ANSWER])
    result = pipe.ask("What is the weather like in Berlin?", request_id="r3")
    assert result.behavior == "out_of_scope"
    assert "rental law" in result.answer
    assert result.citations == []
    assert calls == [], "no LLM call below the floor"


def test_below_floor_case_via_real_confidence(retriever) -> None:
    # Use the retriever's real confidence: an unrelated query scores lower
    # than an on-topic one; set the floor just above the unrelated score.
    unrelated = retriever.confidence("What is the weather like in Berlin?")
    on_topic = retriever.confidence("What happens when the lease ends?")
    assert unrelated < on_topic
    floor = (unrelated + on_topic) / 2
    pipe, _ = make_pipeline(retriever, floor=floor, responses=[GOOD_ANSWER])
    result = pipe.ask("What is the weather like in Berlin?", request_id="r4")
    assert result.behavior == "out_of_scope"


def test_follow_up_rewrite_invoked(retriever, monkeypatch) -> None:
    pipe, calls = make_pipeline(retriever, responses=["deposit return deadline", GOOD_ANSWER])
    rewritten: list[str] = []

    def fake_rewrite(query, history, endpoint, system_prompt, usage_out=None, status_out=None):
        rewritten.append((query, system_prompt))
        return "deposit return deadline"

    monkeypatch.setattr(pipeline_module, "rewrite_query", fake_rewrite)
    pipe.sessions.append("s1", "What about the deposit?", "answer one", now=100.0)
    result = pipe.ask("and when do I get it back?", session_id="s1", request_id="r5", now=101.0)
    assert rewritten, "rewrite must be invoked for the follow-up"
    assert rewritten[0][1] == "REWRITE PROMPT"
    assert result.behavior == "answer"


def test_non_follow_up_skips_rewrite(retriever, monkeypatch) -> None:
    pipe, _ = make_pipeline(retriever, responses=[GOOD_ANSWER])

    def fail_rewrite(*args, **kwargs):
        raise AssertionError("rewrite must not be called for a full-length query")

    monkeypatch.setattr(pipeline_module, "rewrite_query", fail_rewrite)
    pipe.sessions.append("s1", "What happens when the lease ends?", "answer one", now=100.0)
    result = pipe.ask(
        "What happens to the tenancy when the agreed lease term expires in Germany?",
        session_id="s1",
        request_id="r6",
        now=101.0,
    )
    assert result.behavior == "answer"


def test_is_follow_up_heuristic() -> None:
    assert not is_follow_up("What about the deposit?", session_exists=False)
    assert is_follow_up("What about the deposit?", session_exists=True)
    assert is_follow_up("and the deposit?", session_exists=True)
    assert not is_follow_up(
        "How much notice must the tenant give before ending the lease?", session_exists=True
    )


def test_refusal_after_repeated_verification_failure(retriever) -> None:
    bad_answer = 'Invented claim [7] and a wrong quote "völlig erfunden worden hier".'
    pipe, calls = make_pipeline(retriever, responses=[bad_answer])
    result = pipe.ask("What happens when the lease ends?", request_id="r7")
    assert result.behavior == "refusal"
    assert result.citations, "refusal carries nearest retrieved paragraphs"
    assert result.citations[0]["paragraph"]
    # exactly MAX_REGENERATION_ATTEMPTS generation calls
    assert len(calls) == pipeline_module.MAX_REGENERATION_ATTEMPTS


def test_regeneration_on_verification_failure(retriever) -> None:
    bad = "Invented claim [7]."
    good = GOOD_ANSWER
    pipe, calls = make_pipeline(retriever, responses=[bad, good])
    result = pipe.ask("What happens when the lease ends?", request_id="r8")
    assert result.behavior == "answer"
    assert len(calls) == 2, "one regeneration attempt after failure"


def test_gap_annotation_injected_into_prompt(retriever) -> None:
    deposit_answer = (
        "The landlord may hold a security deposit [1]. "
        'The statute says "muss die Anlage vom Vermögen des Vermieters getrennt erfolgen" [1].'
    )
    pipe, calls = make_pipeline(retriever, responses=[deposit_answer])
    result = pipe.ask("Can my landlord keep my security deposit?", request_id="r9")
    assert result.behavior == "answer"
    user_prompts = [c["messages"][-1]["content"] for c in calls]
    assert any("court decisions" in p for p in user_prompts), (
        "gap annotation statement must be injected for deposit questions"
    )


def test_session_store_ttl_and_trimming() -> None:
    store = SessionStore(ttl_seconds=10, max_exchanges=2)
    store.append("s", "q1", "a1", now=1.0)
    store.append("s", "q2", "a2", now=2.0)
    store.append("s", "q3", "a3", now=3.0)
    history = store.get_history("s", now=4.0)
    assert len(history) == 4  # 2 exchanges max = 4 messages
    assert history[0]["content"] == "q2"
    assert store.get_history("s", now=100.0) == []  # TTL expired


def test_debug_trace_does_not_rerun_retrieval(retriever, monkeypatch) -> None:
    """Tracing reads one debug retrieval pass instead of re-running retrieval
    per stage, so stage timings measure the real work."""
    from app.trace import TraceCollector

    embeddings = []
    original = retriever._query_embedding

    def counting(query):
        embeddings.append(query)
        return original(query)

    monkeypatch.setattr(retriever, "_query_embedding", counting)
    pipe, _ = make_pipeline(retriever, responses=[GOOD_ANSWER])
    pipe.ask("When does a fixed-term tenancy end?")
    plain = len(embeddings)

    embeddings.clear()
    collector = TraceCollector(request_id="r", question="q")
    pipe.ask("When does a fixed-term tenancy end?", collector=collector)
    # one embedding serves retrieval and the confidence floor (the untraced
    # path embeds a second time inside confidence())
    assert len(embeddings) == 1 < plain
    stages = [s["stage"] for s in collector.stages]
    assert stages[:2] == ["query_enrichment", "dense_retrieval"]
    assert all("t_ms" in s and "duration_ms" in s for s in collector.stages)


def test_rewrite_reports_fallback_when_model_returns_nothing(monkeypatch) -> None:
    """A reasoning model can spend its whole budget thinking and return no
    content; the original question is used and the fallback is reported."""
    from app import rewriting

    def empty_completion(endpoint, messages, **kwargs):
        assert kwargs["max_tokens"] >= 512
        return {"choices": [{"message": {"content": ""}}], "usage": {"total_tokens": 128}}

    monkeypatch.setattr(rewriting, "chat_completion", empty_completion)
    status: dict = {}
    usage: dict = {}
    result = rewriting.rewrite_query(
        "and for the landlord?", [], None, "PROMPT", usage_out=usage, status_out=status
    )
    assert result == "and for the landlord?"
    assert status == {"fell_back": True}
    assert usage["total_tokens"] == 128
