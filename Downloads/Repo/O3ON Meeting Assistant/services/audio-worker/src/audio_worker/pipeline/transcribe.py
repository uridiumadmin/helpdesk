from __future__ import annotations

import time
from dataclasses import dataclass

from audio_worker.models import AudioChunk, DiarizedSegment, MeetingParticipant, TranscriptSegment
from audio_worker.provider import MeetingAIProvider, TranscriptionRequest


def _transcribe_with_retry(provider, request, max_retries=3):
    last_error = None
    for attempt in range(max_retries):
        try:
            return provider.transcribe(request)
        except (RuntimeError, OSError) as exc:
            last_error = exc
            if attempt < max_retries - 1:
                delay = 2 ** (attempt + 1)
                print(f"[transcribe] attempt {attempt + 1}/{max_retries} failed: {exc}, retrying in {delay}s...")
                time.sleep(delay)
    raise last_error


@dataclass(frozen=True, slots=True)
class TranscriptionPlan:
    language: str
    title: str
    notes: str | None = None


def transcribe_chunks(
    provider: MeetingAIProvider,
    meeting_id: str,
    chunks: tuple[AudioChunk, ...],
    diarized_segments: tuple[DiarizedSegment, ...],
    participants: tuple[MeetingParticipant, ...],
    language: str,
    title: str,
    notes: str | None = None,
) -> tuple[TranscriptSegment, ...]:
    plan = TranscriptionPlan(language=language, title=title, notes=notes)
    transcripts: list[TranscriptSegment] = []
    prior_context = ""
    diarized_by_chunk = {segment.chunk_id: segment for segment in diarized_segments}
    for chunk in chunks:
        diarized_segment = diarized_by_chunk.get(chunk.chunk_id)
        request = TranscriptionRequest(
            meeting_id=meeting_id,
            chunk=chunk,
            language=plan.language,
            participants=participants,
            prior_context=prior_context,
            speaker_hint=diarized_segment.speaker_id if diarized_segment else chunk.speaker_hint,
        )
        try:
            chunk_transcript = _transcribe_with_retry(provider, request)
        except NotImplementedError:
            chunk_transcript = (
                TranscriptSegment(
                    chunk_id=chunk.chunk_id,
                    speaker_id=request.speaker_hint or "speaker_unknown",
                    start_seconds=chunk.start_seconds,
                    end_seconds=chunk.end_seconds,
                    text=(
                        f"[placeholder] transcription pending for chunk {chunk.index} "
                        f"({chunk.start_seconds:.0f}s-{chunk.end_seconds:.0f}s)."
                    ),
                    confidence=0.25,
                ),
            )
        transcripts.extend(chunk_transcript)
        if chunk_transcript:
            prior_context = chunk_transcript[-1].text[-120:]
    return tuple(transcripts)
