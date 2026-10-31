// Types mirroring the FastAPI /ask response contract

export interface Citation {
  index: number
  paragraph: string
  absatz: string
  law_abbr: string
  german_text: string
  gloss_en: string
  deep_link: string
}

export interface AskResponse {
  answer: string
  citations: Citation[]
  disclaimer: string
  corpus_stand_date: string
  request_id: string
  behavior: 'answer' | 'out_of_scope' | 'german_input' | 'refusal'
  gap_note: string | null
  trace: PipelineTrace | null
}

// ---- Pipeline trace ----

export interface TraceStage {
  stage: string
  note?: string
  [key: string]: unknown
}

export interface PipelineTrace {
  request_id: string
  question: string
  stages: TraceStage[]
}

export interface Bm25Candidate {
  rank: number
  paragraph: string
  absatz: string
  score: number
  text_preview: string
}

export interface DenseFusionRow {
  paragraph: string
  paragraph_cosine: number
  best_chunk_cosine: number | null
  heading: string
}

export interface FusionRow {
  paragraph: string
  absatz: string
  rrf_score: number
  arms: Record<string, { rank: number; contribution: number }>
}

export interface SentChunk {
  index: number
  paragraph: string
  absatz: string
  text: string
}

export interface GenerationAttempt {
  answer: string
  verification_passed: boolean
  verification_failures: string[]
}

// ---- Chat session ----

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  response?: AskResponse
  timestamp: number
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  created_at: number
  updated_at: number
}
