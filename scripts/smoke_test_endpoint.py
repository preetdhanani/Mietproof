"""Week-one go/no-go probe for the LLM endpoint and the corpus source.

Run before any eval or ingestion work is built on either dependency:
    uv run python scripts/smoke_test_endpoint.py

Checks, in order:
  1. Endpoint reachability (from this machine; a GitHub-runner check is manual
     or via CI - see the report it prints).
  2. Authentication (a real chat completion at temperature 0).
  3. JSON/structured output support (response_format json_object).
  4. Streaming support.
  5. Whether an embeddings route exists.

Also probes the corpus source (gesetze-im-internet.de): XML per-paragraph
structure, Absatz encoding, machine-readable Stand date availability.

Emits a pass/fail report that decides the judge fallback (paid judge vs
university endpoint) before any eval work depends on it.
"""

import json
import sys
import zipfile
from io import BytesIO

import httpx

RESULTS: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str) -> None:
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")


def _load_dotenv() -> None:
    """Populate os.environ from .env (no dependency; existing env wins)."""
    import os
    from pathlib import Path

    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'").strip('"'))


def probe_endpoint() -> None:
    import os


    _load_dotenv()
    base_url = os.environ.get("LLM_BASE_URL", "").rstrip("/")
    model = os.environ.get("LLM_MODEL", "")
    api_key = os.environ.get("LISA_API", "")

    if not base_url or not model:
        record("endpoint config", False, "LLM_BASE_URL / LLM_MODEL unset - see .env.example")
        return

    headers = {"Authorization": "Bearer " + api_key} if api_key else {}

    # 1. Reachability (some OpenAI-compatible deployments serve /models only
    # under a versioned path or not at all; chat/completions is the real probe)
    try:
        r = httpx.get(f"{base_url}/models", headers=headers, timeout=30)
        reachable = r.status_code < 500 and "text/html" not in r.headers.get("content-type", "")
        record("reachability", reachable, f"GET /models -> {r.status_code}")
    except httpx.HTTPError as e:
        record("reachability", False, f"unreachable: {e}")

    # 2. Authentication + a real completion
    try:
        r = httpx.post(
            f"{base_url}/chat/completions",
            headers=headers,
            json={
                "model": model,
                "messages": [{"role": "user", "content": "Say OK."}],
                "temperature": 0,
                "max_tokens": 10,
            },
            timeout=60,
        )
        ok = r.status_code == 200
        body = r.json() if ok else {}
        content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
        record("auth + completion", ok, f"status {r.status_code}, content={content!r}")
    except httpx.HTTPError as e:
        record("auth + completion", False, f"error: {e}")
        return

    # 3. JSON mode
    try:
        r = httpx.post(
            f"{base_url}/chat/completions",
            headers=headers,
            json={
                "model": model,
                "messages": [{"role": "user", "content": 'Return {"ok": true} as JSON.'}],
                "temperature": 0,
                "max_tokens": 50,
                "response_format": {"type": "json_object"},
            },
            timeout=60,
        )
        if r.status_code == 200:
            content = r.json()["choices"][0]["message"]["content"]
            try:
                json.loads(content)
                record("json mode", True, "response_format=json_object accepted and parsed")
            except json.JSONDecodeError:
                record("json mode", False, f"200 but not JSON: {content[:100]!r}")
        else:
            record("json mode", False, f"status {r.status_code} - judge fallback needed")
    except httpx.HTTPError as e:
        record("json mode", False, f"error: {e}")

    # 4. Streaming
    try:
        with httpx.stream(
            "POST",
            f"{base_url}/chat/completions",
            headers=headers,
            json={
                "model": model,
                "messages": [{"role": "user", "content": "Count 1 to 5."}],
                "temperature": 0,
                "max_tokens": 30,
                "stream": True,
            },
            timeout=60,
        ) as r:
            chunks = 0
            if r.status_code == 200:
                for line in r.iter_lines():
                    if line.startswith("data: ") and line != "data: [DONE]":
                        chunks += 1
            record("streaming", r.status_code == 200 and chunks > 0, f"{chunks} chunks")
    except httpx.HTTPError as e:
        record("streaming", False, f"error: {e}")

    # 5. Embeddings route
    try:
        r = httpx.post(
            f"{base_url}/embeddings",
            headers=headers,
            json={"model": model, "input": "test"},
            timeout=30,
        )
        detail = f"status {r.status_code} (not required - local embeddings)"
        record("embeddings route", r.status_code == 200, detail)
    except httpx.HTTPError as e:
        record("embeddings route", False, f"error: {e} (not required - local embeddings)")


def probe_corpus_source() -> None:
    # XML per-paragraph structure, Absatz encoding, machine-readable Stand date.
    url = "https://www.gesetze-im-internet.de/bgb/xml.zip"
    try:
        r = httpx.get(url, timeout=120, follow_redirects=True)
        record(
            "corpus fetch",
            r.status_code == 200,
            f"GET {url} -> {r.status_code}, {len(r.content)} bytes",
        )
        if r.status_code != 200:
            return
    except httpx.HTTPError as e:
        record("corpus fetch", False, f"error: {e}")
        return

    try:
        zf = zipfile.ZipFile(BytesIO(r.content))
        names = zf.namelist()
        record("corpus zip structure", True, f"{len(names)} files: {names[:5]}")
        xml_names = [n for n in names if n.endswith(".xml")]
        if not xml_names:
            record("corpus XML present", False, "no .xml in zip")
            return
        raw = zf.read(xml_names[0])
        text = raw.decode("utf-8", errors="replace")

        has_norm = "<norm" in text
        has_enbez = "enbez" in text
        has_stand = "Stand" in text or "stand" in text.lower()
        record(
            "per-paragraph structure",
            has_norm and has_enbez,
            f"<norm>={has_norm}, enbez={has_enbez}",
        )
        record("stand date present", has_stand, "searched for Stand marker in XML text")

        # Absatz encoding: look for (1)/(2) markers inside a paragraph text
        import re

        absatz_markers = re.findall(r"\(\d+\)", text)
        record(
            "absatz markers",
            len(absatz_markers) > 100,
            f"{len(absatz_markers)} '(n)' markers found",
        )
    except zipfile.BadZipFile as e:
        record("corpus zip parse", False, f"bad zip: {e}")


def main() -> int:
    print("=== LLM endpoint probe ===")
    probe_endpoint()
    print("\n=== Corpus source probe (gesetze-im-internet.de) ===")
    probe_corpus_source()

    print("\n=== Summary ===")
    failed = [r for r in RESULTS if not r[1]]
    for name, ok, _detail in RESULTS:
        print(f"  {'[x]' if ok else '[ ]'} {name}")
    if failed:
        print(f"\n{len(failed)} check(s) failed - see details above.")
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
