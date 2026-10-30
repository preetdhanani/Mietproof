# Evaluation methodology

## The golden test set

`evals/golden_set.jsonl` holds 40 hand-verified question/answer pairs
sourced from real expat questions (r/germany wiki, tenant-association FAQ
themes): deposits, notice periods, rent increases, repairs, landlord entry,
subletting, modernization, sale of the flat, inheritance of the tenancy,
plus deliberate edge cases. Each record carries:

- `expected_paragraphs` - the governing §/§§ (references, not chunk text)
- `expected_answer_points` - the points a correct answer must cover
- `verified_quotes` - German excerpts recorded at authoring time, verified
  verbatim against the corpus
- `expected_behavior` - `answer`, `names_gap`, or `out_of_scope`
- `verified_against_stand` / `verification_date` - the corpus Stand date
  the pair was checked against

**Verification process and its limits.** Each pair was written by locating
the governing paragraph(s) in the committed snapshot, extracting the
expected answer points from the German text, and recording the verified
quotes verbatim (whitespace-normalized matching). Translation assistance
was used for reading the German; the limits: the author is not a lawyer,
the pairs check statutory content (not legal practice), and the
`expected_answer_points` are a coverage checklist, not a model answer.

The split: 32 calibration / 8 held-out is planned for threshold work; at
the current stage all 40 are reported together (the held-out slice will be
reported separately in the README's eval table once the scheduled tier has
its baseline).

## The two tiers

### Deterministic tier (every PR, no LLM)

Four checks (`evals/deterministic.py`):

1. **Retrieval hit-rate at k=5** - at least one expected § among the
   top-5 retrieved chunks, paragraph-level via chunk metadata. Threshold:
   >= 90% of applicable (`answer`) items, a fixed count ("29 of 30").
2. **Index integrity** - the collection manifest's embedder, corpus hash,
   and Stand date must match the built index; fails loudly on mismatch.
3. **Recorded-quote faithfulness** - every `verified_quotes` entry must
   appear in the current index's paragraph records after whitespace
   normalization. Catches a corpus change silently invalidating the set.
4. **Out-of-scope floor check** - `out_of_scope` records must score below
   the calibrated floor, `answer`/`names_gap` records above it. Skipped
   with a warning until `evals/baselines/floor.json` exists.

The gate fails a PR below threshold. "Could not run" (infrastructure) is
reported as neutral in CI, never as a red badge.

### Scheduled tier (nightly, judge-scored)

The RAGAS adapter (`evals/ragas_adapter.py`, pinned version) runs
faithfulness, answer relevancy, context precision, and context recall with
a separate judge configuration (`JUDGE_*`), temperature 0, concurrency 4
dropping to 2 on 429s. It also runs the **point-coverage check**: each
generated answer is scored against its item's `expected_answer_points`
(and, for `names_gap` records, the gap-annotation map's statement).

**Threshold semantics**: judge metrics are reported against mean - 2σ
bands from at least five repeated temperature-0 baseline runs
(`evals/baselines/`); they warn only (run-log flag + auto-opened issue),
nothing on the scheduled tier blocks. Any change to the configuration
tuple (corpus Stand, embedding model, generator, judge, prompt version)
requires explicit threshold re-justification recorded in the run log.

## The out-of-scope floor

The retrieval-confidence floor decides answer vs. out-of-scope response.
Calibration method (build step 6): collect each backend's normalized
`confidence(query)` over all 40 golden items, then pick the threshold that
maximizes complementary accuracy (out-of-scope below, in-scope above).
The calibrated value lives in `evals/baselines/floor.json` so the app
config and CI read the same number; `OUT_OF_SCOPE_FLOOR` overrides it.

**Calibration result (dense/hybrid, e5-base, Stand 2026-07-23):**
floor = 0.8913, complementary accuracy 90% (36/40). The in-scope minimum
(0.878) and out-of-scope maximum (0.898) overlap heavily - e5 cosine is a
compressed, weak out-of-scope signal. The covered-topics response and the
gap-annotation map carry the real scoping work; the floor is a backstop.
Re-calibrate on any backend or corpus change.

## Re-baselining after a configuration change

1. Re-run ingestion for the new corpus Stand or embedding model.
2. Re-run the deterministic gate on the candidate collection
   (`run_eval.py --tier deterministic --collection <name>`).
3. Re-run the comparison (`--tier compare`) and re-publish the table.
4. Re-calibrate the floor (method above) and commit the new floor.json.
5. Run at least five temperature-0 baseline runs of the scheduled tier,
   store the bands in `evals/baselines/`, and record the re-justification
   in the run log.
6. Golden items whose cited paragraphs changed are flagged by
   `evals/stand_diff.py` and re-verified by hand before cutover.
