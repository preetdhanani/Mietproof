/** Same tokenizer as the backend's BM25 (retrieval/bm25.py): lowercase,
 * strip accents, split on letters/digits. */
export function tokenize(text: string): string[] {
  const plain = text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
  return plain.match(/[a-z0-9ß]+/g) ?? []
}

/** Split text into parts, marking words whose BM25 token is in `terms`. */
export function markTerms(text: string, terms: Set<string>): Array<{ text: string; term: string | null }> {
  const parts: Array<{ text: string; term: string | null }> = []
  for (const piece of text.split(/(\s+)/)) {
    const token = tokenize(piece).find((t) => terms.has(t)) ?? null
    parts.push({ text: piece, term: token })
  }
  return parts
}

export function fmtMs(ms: number | undefined | null): string {
  if (ms === undefined || ms === null) return ''
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export const fmtInt = (n: number | undefined) => (n === undefined ? '-' : n.toLocaleString('en-US'))

export function para(paragraph: string, absatz?: string): string {
  return `§ ${paragraph}${absatz && absatz !== '0' ? ` Abs. ${absatz}` : ''}`
}
