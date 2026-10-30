"""The scheduled judge-scored tier - the only file that imports ``ragas``.

Pinned RAGAS version (pyproject pins ragas==0.2.6); metrics: faithfulness,
answer relevancy, context precision, context recall. The judge model comes
from the separate ``JUDGE_*`` configuration and runs its own client, so the
generator endpoint's unresolved JSON-mode support does not constrain the
judge. Temperature 0; judge concurrency starts at 4 and drops to 2 when the
judge returns 429s, with backoff.

Also implements the scheduled tier's point-coverage check: each generated
answer is scored against its golden item's ``expected_answer_points`` (and,
for ``names_gap`` records, the gap-annotation map's statement) - the
answer-level verification the deterministic tier cannot do.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
GAP_ANNOTATIONS_PATH = REPO_ROOT / "app" / "gap_annotations.json"
PER_QUESTION_RESULTS_DIR = REPO_ROOT / "evals" / "results"


class JudgeUnavailable(Exception):
    """The judge endpoint is unreachable - the scheduled tier skips."""


def _judge_settings():
    from app.config import get_settings

    settings = get_settings()
    judge = settings.judge()
    if not judge.configured():
        raise JudgeUnavailable("JUDGE_* configuration unset - scheduled tier skipped")
    return settings, judge


def build_ragas_config() -> dict:
    """The configuration tuple recorded with every scheduled run."""
    _settings, judge = _judge_settings()
    return {
        "metrics": ["faithfulness", "answer_relevancy", "context_precision", "context_recall"],
        "judge_model": judge.model,
        "judge_base_url": judge.base_url,
        "temperature": 0.0,
        "judge_concurrency_start": 4,
        "judge_concurrency_min": 2,
        "ragas_version": _ragas_version(),
    }


def _ragas_version() -> str:
    try:
        import importlib.metadata

        return importlib.metadata.version("ragas")
    except Exception:  # noqa: BLE001
        return "unknown"


def run_ragas_tier(collection_dir: Path) -> dict:
    """Generate answers on the generator endpoint, judge them with RAGAS.

    Skips (JudgeUnavailable) when the judge is unreachable - the scheduled
    workflow turns that into a neutral status, never a red run.
    """
    settings, _judge = _judge_settings()

    from evals.deterministic import load_golden_set
    from retrieval.factory import build_retriever

    retriever = build_retriever(collection_dir)
    items = load_golden_set()

    # 1. Generate answers + retrieved contexts per question (generator endpoint)
    per_question = []
    for item in items:
        chunks = retriever.retrieve(item["question"], k=5)
        contexts = [c.chunk_text for c in chunks]
        answer, error = _generate_answer(settings, item["question"], chunks)
        per_question.append(
            {
                "id": item["id"],
                "question": item["question"],
                "answer": answer,
                "contexts": contexts,
                "expected_answer_points": item["expected_answer_points"],
                "expected_paragraphs": item["expected_paragraphs"],
                "expected_behavior": item["expected_behavior"],
                "error": error,
            }
        )

    # 2. Point-coverage check (LLM-scored against expected_answer_points)
    coverage = _point_coverage(settings, per_question)

    # 3. RAGAS metrics (judge endpoint, its own client)
    ragas_scores = _ragas_scores(per_question)

    return {
        "tier": "full",
        "collection": collection_dir.name,
        "config": build_ragas_config(),
        "point_coverage": coverage,
        "ragas": ragas_scores,
        "per_question_count": len(per_question),
    }


def _generate_answer(settings, question: str, chunks) -> tuple[str, str | None]:
    from app.llm import LLMError, chat_completion

    prompt_parts = [f"Retrieved chunks: [{i + 1}] {c.chunk_text}" for i, c in enumerate(chunks)]
    try:
        body = chat_completion(
            settings.generator(),
            messages=[
                {
                    "role": "system",
                    "content": (REPO_ROOT / "app" / "prompts" / "answer.md").read_text(
                        encoding="utf-8"
                    ),
                },
                {"role": "user", "content": "\n".join(prompt_parts) + f"\n\nQuestion: {question}"},
            ],
        )
        return (body["choices"][0]["message"]["content"] or "").strip(), None
    except LLMError as exc:
        return "", f"generator error: {exc}"


def _point_coverage(settings, per_question: list[dict]) -> dict:
    """Score each answer against its golden item's expected answer points."""
    from app.llm import LLMError, chat_completion

    annotations = json.loads(GAP_ANNOTATIONS_PATH.read_text(encoding="utf-8"))
    results = []
    covered = 0
    scored_count = 0
    for record in per_question:
        if record["error"] or not record["answer"]:
            results.append({"id": record["id"], "covered": None, "error": record["error"]})
            continue
        points = list(record["expected_answer_points"])
        if record["expected_behavior"] == "names_gap" and not points:
            # the gap-annotation map's statement is the expectation
            points = [
                f"{e['what_the_statute_regulates']} {e['what_is_governed_elsewhere']}"
                for e in annotations.get("topics", [])
            ][:1]
        if not points:
            results.append({"id": record["id"], "covered": None, "error": "no expected points"})
            continue
        points_text = "\n".join(f"- {p}" for p in points)
        try:
            body = chat_completion(
                settings.judge(),
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You verify answers against expected points. For each expected "
                            "point, state whether the answer covers it (yes/no/partial). "
                            "End with 'COVERED: <number of fully covered points>/<total>'."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Expected points:\n{points_text}\n\nAnswer:\n{record['answer']}"
                        ),
                    },
                ],
            )
            text = body["choices"][0]["message"]["content"] or ""
            covered_count, total = _parse_coverage(text, len(points))
            scored_count += 1
            covered += covered_count / total if total else 0
            results.append({"id": record["id"], "covered": covered_count, "total": total})
        except LLMError as exc:
            results.append({"id": record["id"], "covered": None, "error": str(exc)})
    rate = covered / scored_count if scored_count else None
    return {"rate": rate, "scored": scored_count, "per_item": results}


def _parse_coverage(text: str, total: int) -> tuple[int, int]:
    import re

    match = re.search(r"COVERED:\s*(\d+)\s*/\s*(\d+)", text)
    if match:
        return int(match.group(1)), int(match.group(2))
    return 0, total


def _ragas_scores(per_question: list[dict]) -> dict:
    """Run the pinned RAGAS metrics; degrade gracefully when unavailable."""
    usable = [r for r in per_question if r["answer"] and r["contexts"]]
    if not usable:
        return {"error": "no generated answers to score"}
    try:
        from datasets import Dataset
        from ragas import evaluate
        from ragas.metrics import (
            answer_relevancy,
            context_precision,
            context_recall,
            faithfulness,
        )
    except Exception as exc:  # noqa: BLE001
        return {"error": f"ragas import failed: {exc}"}

    _settings, judge = _judge_settings()
    from langfuse.openai import (
        OpenAI as LangfuseOpenAI,  # noqa: F401  (ragas uses langfuse-wrapped client)
    )

    try:
        from langchain_openai import ChatOpenAI
        from ragas.llms import LangchainLLMWrapper

        judge_llm = LangchainLLMWrapper(
            ChatOpenAI(
                model=judge.model,
                temperature=0,
                openai_api_key=judge.api_key,
                openai_api_base=judge.base_url,
            )
        )
    except Exception as exc:  # noqa: BLE001
        return {"error": f"judge LLM wrapper failed: {exc}"}

    dataset = Dataset.from_dict(
        {
            "question": [r["question"] for r in usable],
            "answer": [r["answer"] for r in usable],
            "contexts": [r["contexts"] for r in usable],
            "ground_truth": [
                " ".join(r["expected_answer_points"]) or " ".join(r["expected_paragraphs"])
                for r in usable
            ],
        }
    )
    started = time.time()
    try:
        result = evaluate(
            dataset,
            metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
            llm=judge_llm,
        )
    except Exception as exc:  # noqa: BLE001
        return {"error": f"ragas evaluate failed: {exc}"}

    scores = {}
    for key in ("faithfulness", "answer_relevancy", "context_precision", "context_recall"):
        try:
            scores[key] = float(result[key])
        except (KeyError, TypeError, ValueError):
            scores[key] = None
    return {"scores": scores, "elapsed_seconds": round(time.time() - started, 1)}


def write_per_question(
    per_question: list[dict], results_dir: Path = PER_QUESTION_RESULTS_DIR
) -> Path:
    results_dir.mkdir(parents=True, exist_ok=True)
    path = results_dir / "ragas_per_question.json"
    path.write_text(json.dumps(per_question, ensure_ascii=False, indent=1), encoding="utf-8")
    return path
