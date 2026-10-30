"""Cross-lingual query enrichment: a curated EN→DE legal-term lexicon.

English expat questions use colloquial wording; the corpus is German
legalese. Dense embeddings bridge part of that gap, but key legal concepts
(Mietminderung, Kündigungsfrist, Kaution) benefit from being named in
German alongside the English query. This module appends the German terms
for recognized English phrases - no LLM, deterministic, cheap.

The lexicon is deliberately small and curated: it maps the recurring
concepts of the rental-law domain, not arbitrary text.
"""

from __future__ import annotations

# (English phrase fragment, German legal terms appended)
_LEXICON: list[tuple[str, str]] = [
    ("pay less rent", "Mietminderung"),
    ("reduce the rent", "Mietminderung"),
    ("lower the rent", "Mietminderung"),
    ("rent reduction", "Mietminderung"),
    ("heating", "Mangel Heizung"),
    ("broken", "Mangel"),
    ("defect", "Mangel"),
    ("mold", "Mangel Feuchtigkeit"),
    ("deposit", "Kaution Sicherheitsleistung"),
    ("security deposit", "Kaution Sicherheitsleistung"),
    ("notice", "Kündigungsfrist Kündigung"),
    ("ending my lease", "Kündigung Mietverhältnis beenden"),
    ("move out", "Kündigung Auszug"),
    ("terminat", "Kündigung"),
    ("rent increase", "Mieterhöhung"),
    ("raise the rent", "Mieterhöhung"),
    ("sublet", "Untermiete Gebrauchsüberlassung"),
    ("someone else", "Dritter Gebrauchsüberlassung"),
    ("repairs", "Instandhaltung Instandsetzung"),
    ("repair", "Instandhaltung"),
    ("modernization", "Modernisierung"),
    ("renovation", "Modernisierungsmaßnahme"),
    ("wear and tear", "Abnutzung vertragsgemäßer Gebrauch"),
    ("normal wear", "Abnutzung"),
    ("repainting", "Schönheitsreparaturen"),
    ("paint the walls", "Schönheitsreparaturen"),
    ("operating costs", "Betriebskosten"),
    ("utilities", "Betriebskosten Nebenkosten"),
    ("landlord enter", "Zutritt Vermieter"),
    ("entry", "Zutritt"),
    ("lease term", "Mietzeit Befristung"),
    ("fixed term", "Zeitmietvertrag Befristung"),
    ("inherit", "Erbau Eintrittsrecht Tod"),
    ("death of", "Tod des Mieters Eintrittsrecht"),
    ("eviction", "Räumungsklage Kündigung"),
    ("terminate early", "fristlose Kündigung außerordentlich"),
    ("rent cap", "Mietpreisbremse"),
    ("rent control", "Mietpreisbremse"),
]


def enrich_query(query: str) -> str:
    """Append German legal terms for recognized English phrases."""
    lowered = query.lower()
    extras = [de for en, de in _LEXICON if en in lowered]
    if not extras:
        return query
    return query + " " + " ".join(extras)
