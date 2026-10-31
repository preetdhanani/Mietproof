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
  /** ms since the request started, when this stage was recorded */
  t_ms?: number
  /** ms this stage took */
  duration_ms?: number
  [key: string]: unknown
}

export interface TraceMeta {
  llm_model: string
  retrieval_backend: string
  embedding_model: string
  collection: string
  prompt_version: string
}

export interface TokenUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface PipelineTrace {
  request_id: string
  question: string
  meta?: TraceMeta
  total_ms?: number
  usage?: TokenUsage
  stages: TraceStage[]
}

/** One line of the /ask/stream NDJSON response */
export type StreamEvent =
  | { type: 'start'; request_id: string; meta: TraceMeta }
  | { type: 'stage'; stage: TraceStage }
  /** the LLM started attempt n (a retry restarts the draft) */
  | { type: 'llm_start'; attempt: number }
  /** a batch of streamed LLM text - an unverified draft, never the answer */
  | { type: 'delta'; attempt: number; kind: 'reasoning' | 'content'; text: string }
  | { type: 'result'; response: AskResponse }
  | { type: 'error'; status: number; error: string; request_id?: string }

/** What the LLM has streamed so far for one attempt. */
export interface Draft {
  reasoning: string
  content: string
}

/** A request in flight: the trace so far plus the LLM drafts per attempt. */
export interface LiveRun {
  sessionId: string
  messageId: string
  trace: PipelineTrace | null
  drafts: Record<number, Draft>
  /** attempt currently streaming, if any */
  streaming: number | null
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
  /** partial trace kept when the request failed midway */
  liveTrace?: PipelineTrace
  /** set when the request failed */
  error?: string
  timestamp: number
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  created_at: number
  updated_at: number
}
