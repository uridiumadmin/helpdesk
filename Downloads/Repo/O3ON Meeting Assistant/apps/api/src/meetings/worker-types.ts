export interface WorkerTranscriptSegment {
  chunk_id: string;
  speaker_id: string;
  start_seconds: number;
  end_seconds: number;
  text: string;
  confidence: number;
}

export interface WorkerActionItem {
  task: string;
  owner?: string | null;
  due_date?: string | null;
  priority?: string;
  confidence: number;
  evidence?: string | null;
}

export interface WorkerArtifact {
  meeting_id: string;
  language: string;
  summary: string;
  meeting_minutes: string;
  decisions: string[];
  action_items: WorkerActionItem[];
  risks: string[];
  next_steps: string[];
  provider_name: string;
}

export interface WorkerProcessingResult {
  meeting_id: string;
  normalized_audio_uri: string;
  transcript_segments: WorkerTranscriptSegment[];
  artifact: WorkerArtifact;
  provider_name: string;
  warnings?: string[];
}

export interface ChunkTranscribePayload {
  meeting_id: string;
  chunk_id: string;
  title: string;
  language: string;
  audio_uri: string;
  duration_seconds: number;
  participants: { id: string; name: string; speaker_label?: string }[];
  prior_context: string;
}

export interface ChunkTranscribeResult {
  chunk_id: string;
  transcript_segments: WorkerTranscriptSegment[];
  warnings?: string[];
}

export interface SummarizePayload {
  meeting_id: string;
  title: string;
  language: string;
  transcript_segments: WorkerTranscriptSegment[];
  participants: { id: string; name: string; speaker_label?: string }[];
  notes: string;
}

export interface SummarizeResult {
  meeting_id: string;
  artifact: WorkerArtifact;
  warnings?: string[];
}
