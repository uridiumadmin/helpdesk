from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass
from pathlib import Path

from audio_worker.config import WorkerSettings
from audio_worker.models import (
    AudioChunk,
    AudioSource,
    MeetingArtifact,
    MeetingParticipant,
    ProcessingRequest,
    ProcessingResult,
    TranscriptSegment,
)
from audio_worker.pipeline.chunk import chunk_audio
from audio_worker.pipeline.diarize import diarize_chunks
from audio_worker.pipeline.normalize import normalize_audio_source
from audio_worker.pipeline.summarize import summarize_transcript
from audio_worker.pipeline.transcribe import transcribe_chunks, _transcribe_with_retry
from audio_worker.provider import DiarizationRequest, MeetingAIProvider, SummaryRequest, TranscriptionRequest

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class MeetingPipeline:
    settings: WorkerSettings
    provider: MeetingAIProvider

    def process(self, request: ProcessingRequest) -> ProcessingResult:
        self.settings.validate()

        normalized = normalize_audio_source(request.audio_source, self.settings)
        _cleanup_paths: list[Path] = []
        try:
            # Track the normalized file for cleanup
            normalized_path = Path(normalized.normalized_uri)
            _cleanup_paths.append(normalized_path)
            # Chunks are written to a "chunks" subdirectory next to the normalized file
            chunks_dir = normalized_path.parent / "chunks"
            _cleanup_paths.append(chunks_dir)

            chunks = chunk_audio(
                normalized_source=normalized,
                chunk_seconds=request.chunk_seconds or self.settings.chunk_seconds,
                overlap_seconds=request.chunk_overlap_seconds or self.settings.chunk_overlap_seconds,
            )
            diarized_segments = diarize_chunks(
                chunks=chunks,
                participants=request.participants,
                enrollments=request.enrollments,
                max_speakers=self.settings.max_speakers,
                normalized_audio_path=normalized.normalized_uri,
            )
            # Transcription — if using gpt-4o-transcribe-diarize, speaker labels
            # come back directly from the API in diarized_json format.
            transcript_segments = transcribe_chunks(
                provider=self.provider,
                meeting_id=request.meeting_id,
                chunks=chunks,
                diarized_segments=diarized_segments,
                participants=request.participants,
                language=request.language,
                title=request.title,
                notes=request.notes,
            )
            # If the transcription model does NOT include diarization (e.g. whisper-1),
            # use GPT-4o as a fallback to assign speakers from context.
            uses_diarize_model = "diarize" in self.settings.transcription_model
            if not uses_diarize_model and request.participants:
                try:
                    diarization_request = DiarizationRequest(
                        meeting_id=request.meeting_id,
                        language=request.language,
                        title=request.title,
                        transcript_segments=transcript_segments,
                        participants=request.participants,
                    )
                    transcript_segments = self.provider.diarize_transcript(diarization_request)
                except (NotImplementedError, Exception) as exc:
                    print(f"[pipeline] GPT diarization fallback skipped: {exc}")

            artifact = summarize_transcript(
                provider=self.provider,
                meeting_id=request.meeting_id,
                language=request.language,
                title=request.title,
                transcript_segments=transcript_segments,
                participants=request.participants,
                notes=request.notes,
            )
            warnings = tuple(normalized.warnings)
            return ProcessingResult(
                meeting_id=request.meeting_id,
                normalized_audio_uri=normalized.normalized_uri,
                chunks=chunks,
                diarized_segments=diarized_segments,
                transcript_segments=transcript_segments,
                artifact=artifact,
                provider_name=self.provider.provider_name,
                warnings=warnings,
            )
        finally:
            self._cleanup_temp_files(_cleanup_paths, request.meeting_id)

    def transcribe_single_chunk(
        self,
        meeting_id: str,
        chunk_id: str,
        title: str,
        language: str,
        audio_uri: str,
        duration_seconds: float,
        participants: tuple[MeetingParticipant, ...],
        prior_context: str = "",
    ) -> dict:
        """Normalize and transcribe a single uploaded audio chunk (no re-chunking)."""
        self.settings.validate()

        source = AudioSource(
            source_id=chunk_id,
            uri=audio_uri,
            duration_seconds=duration_seconds,
            language=language,
        )
        normalized = normalize_audio_source(source, self.settings)
        _cleanup_paths: list[Path] = []
        try:
            normalized_path = Path(normalized.normalized_uri)
            _cleanup_paths.append(normalized_path)

            # Treat the entire file as a single chunk — no sub-chunking
            chunk = AudioChunk(
                chunk_id=chunk_id,
                index=0,
                start_seconds=0.0,
                end_seconds=normalized.duration_seconds or duration_seconds,
                overlap_seconds=0.0,
                source_id=chunk_id,
                chunk_uri=normalized.normalized_uri,
            )

            request = TranscriptionRequest(
                meeting_id=meeting_id,
                chunk=chunk,
                language=language,
                participants=participants,
                prior_context=prior_context,
            )

            transcript_segments = _transcribe_with_retry(self.provider, request)

            # If the model doesn't do diarization, try GPT fallback
            uses_diarize_model = "diarize" in self.settings.transcription_model
            if not uses_diarize_model and participants:
                try:
                    diarization_request = DiarizationRequest(
                        meeting_id=meeting_id,
                        language=language,
                        title=title,
                        transcript_segments=transcript_segments,
                        participants=participants,
                    )
                    transcript_segments = self.provider.diarize_transcript(diarization_request)
                except (NotImplementedError, Exception) as exc:
                    print(f"[transcribe_single_chunk] GPT diarization fallback skipped: {exc}")

            warnings = list(normalized.warnings)
            segments_list = [
                {
                    "speaker": seg.speaker_id,
                    "text": seg.text,
                    "start": seg.start_seconds,
                    "end": seg.end_seconds,
                    "confidence": seg.confidence,
                }
                for seg in transcript_segments
            ]
            return {
                "chunk_id": chunk_id,
                "transcript_segments": segments_list,
                "warnings": warnings,
            }
        finally:
            self._cleanup_temp_files(_cleanup_paths, meeting_id)

    def summarize_transcript_only(
        self,
        meeting_id: str,
        title: str,
        language: str,
        transcript_segments: tuple[TranscriptSegment, ...],
        participants: tuple[MeetingParticipant, ...],
        notes: str = "",
    ) -> dict:
        """Run summarization on pre-merged transcript segments (no audio processing)."""
        self.settings.validate()

        artifact: MeetingArtifact = summarize_transcript(
            provider=self.provider,
            meeting_id=meeting_id,
            language=language,
            title=title,
            transcript_segments=transcript_segments,
            participants=participants,
            notes=notes,
        )
        return {
            "meeting_id": meeting_id,
            "artifact": artifact.to_dict(),
            "warnings": [],
        }

    @staticmethod
    def _cleanup_temp_files(paths: list[Path], meeting_id: str) -> None:
        """Remove normalized audio file and chunk files created during processing."""
        for path in paths:
            try:
                if path.is_dir():
                    shutil.rmtree(path, ignore_errors=True)
                elif path.is_file():
                    path.unlink(missing_ok=True)
            except OSError as exc:
                logger.warning(
                    "Failed to clean up temp file %s for meeting %s: %s",
                    path, meeting_id, exc,
                )
