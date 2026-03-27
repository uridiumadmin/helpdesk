from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Protocol
from urllib import error, request as urllib_request
import uuid

from audio_worker.models import (
    ActionItem,
    AudioChunk,
    MeetingArtifact,
    MeetingParticipant,
    TranscriptSegment,
)


@dataclass(frozen=True, slots=True)
class TranscriptionRequest:
    meeting_id: str
    chunk: AudioChunk
    language: str
    participants: tuple[MeetingParticipant, ...]
    prior_context: str = ""
    speaker_hint: str | None = None


@dataclass(frozen=True, slots=True)
class SummaryRequest:
    meeting_id: str
    language: str
    title: str
    transcript_segments: tuple[TranscriptSegment, ...]
    participants: tuple[MeetingParticipant, ...]
    notes: str | None = None


class MeetingAIProvider(Protocol):
    provider_name: str

    def transcribe(self, request: TranscriptionRequest) -> tuple[TranscriptSegment, ...]:
        raise NotImplementedError

    def summarize(self, request: SummaryRequest) -> MeetingArtifact:
        raise NotImplementedError


def _extract_json_blob(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in provider response.")
    return text[start : end + 1]


def _build_multipart_body(fields: dict[str, str], file_field: str, file_path: Path) -> tuple[bytes, str]:
    boundary = f"----o3on-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    line_break = b"\r\n"
    for key, value in fields.items():
        chunks.append(f"--{boundary}".encode("utf-8"))
        chunks.append(line_break)
        chunks.append(
            f'Content-Disposition: form-data; name="{key}"'.encode("utf-8")
        )
        chunks.append(line_break)
        chunks.append(line_break)
        chunks.append(str(value).encode("utf-8"))
        chunks.append(line_break)

    chunks.append(f"--{boundary}".encode("utf-8"))
    chunks.append(line_break)
    chunks.append(
        f'Content-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"'.encode(
            "utf-8"
        )
    )
    chunks.append(line_break)
    chunks.append(b"Content-Type: application/octet-stream")
    chunks.append(line_break)
    chunks.append(line_break)
    chunks.append(file_path.read_bytes())
    chunks.append(line_break)
    chunks.append(f"--{boundary}--".encode("utf-8"))
    chunks.append(line_break)
    return b"".join(chunks), boundary


def _chat_message_to_text(payload: dict) -> str:
    choices = payload.get("choices") or []
    if not choices:
        raise ValueError("Chat completion returned no choices.")

    message = choices[0].get("message", {})
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [part.get("text", "") for part in content if isinstance(part, dict)]
        return "".join(parts)
    raise ValueError("Unsupported chat completion content format.")


@dataclass(frozen=True, slots=True)
class OpenAIProviderAdapter:
    api_key: str | None
    transcription_model: str
    summary_model: str
    base_url: str = "https://api.openai.com/v1"
    provider_name: str = "openai"

    def build_transcription_payload(self, request: TranscriptionRequest) -> dict:
        return {
            "model": self.transcription_model,
            "language": request.language,
            "prompt": (
                f"Serbian meeting audio. Speaker hint: {request.speaker_hint or 'unknown'}. "
                f"Prior context: {request.prior_context or 'none'}"
            ),
        }

    def build_summary_payload(self, request: SummaryRequest) -> dict:
        transcript_text = "\n".join(
            f"{segment.speaker_id}: {segment.text}" for segment in request.transcript_segments
        )
        return {
            "model": self.summary_model,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You produce Serbian meeting summaries as strict JSON. "
                        "Return keys: summary, meeting_minutes, decisions, action_items, risks, next_steps."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Meeting title: {request.title}\n"
                        f"Language: {request.language}\n"
                        f"Participants: {', '.join(p.display_name for p in request.participants) or 'unknown'}\n"
                        f"Notes: {request.notes or 'none'}\n"
                        f"Transcript:\n{transcript_text}\n\n"
                        "Return valid JSON only. action_items must be an array of objects with keys "
                        "task, owner, due_date, priority, confidence, evidence."
                    ),
                },
            ],
        }

    def transcribe(self, request: TranscriptionRequest) -> tuple[TranscriptSegment, ...]:
        if not self.api_key:
            raise NotImplementedError("OPENAI_API_KEY is not configured.")

        source = Path(request.chunk.chunk_uri or "")
        if not source.exists():
            raise FileNotFoundError(f"Chunk audio file does not exist: {source}")

        payload = self.build_transcription_payload(request)
        body, boundary = _build_multipart_body(payload, "file", source)
        http_request = urllib_request.Request(
            url=f"{self.base_url}/audio/transcriptions",
            method="POST",
            data=body,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
        )

        try:
            with urllib_request.urlopen(http_request, timeout=120) as response:
                data = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            raise RuntimeError(f"OpenAI transcription failed with status {exc.code}.") from exc

        text = str(data.get("text") or "").strip()
        if not text:
            raise RuntimeError("OpenAI transcription returned empty text.")

        return (
            TranscriptSegment(
                chunk_id=request.chunk.chunk_id,
                speaker_id=request.speaker_hint or "speaker_unknown",
                start_seconds=request.chunk.start_seconds,
                end_seconds=request.chunk.end_seconds,
                text=text,
                confidence=0.9,
            ),
        )

    def summarize(self, request: SummaryRequest) -> MeetingArtifact:
        if not self.api_key:
            raise NotImplementedError("OPENAI_API_KEY is not configured.")

        payload = json.dumps(self.build_summary_payload(request)).encode("utf-8")
        http_request = urllib_request.Request(
            url=f"{self.base_url}/chat/completions",
            method="POST",
            data=payload,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )

        try:
            with urllib_request.urlopen(http_request, timeout=120) as response:
                data = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            raise RuntimeError(f"OpenAI summary failed with status {exc.code}.") from exc

        content = _chat_message_to_text(data)
        summary_payload = json.loads(_extract_json_blob(content))
        action_items = tuple(
            ActionItem(
                task=str(item.get("task", "")).strip() or "Review transcript",
                owner=item.get("owner"),
                due_date=item.get("due_date"),
                priority=str(item.get("priority", "medium")),
                confidence=float(item.get("confidence", 0.0)),
                evidence=item.get("evidence"),
            )
            for item in summary_payload.get("action_items", [])
            if isinstance(item, dict)
        )

        return MeetingArtifact(
            meeting_id=request.meeting_id,
            language=request.language,
            summary=str(summary_payload.get("summary", "")).strip() or f"Summary for {request.title}",
            meeting_minutes=str(summary_payload.get("meeting_minutes", "")).strip(),
            decisions=tuple(str(item) for item in summary_payload.get("decisions", [])),
            action_items=action_items,
            risks=tuple(str(item) for item in summary_payload.get("risks", [])),
            next_steps=tuple(str(item) for item in summary_payload.get("next_steps", [])),
            provider_name=self.provider_name,
        )


@dataclass(frozen=True, slots=True)
class StubMeetingAIProvider:
    provider_name: str = "stub"

    def transcribe(self, request: TranscriptionRequest) -> tuple[TranscriptSegment, ...]:
        speaker_id = request.speaker_hint or "speaker_unknown"
        text = (
            f"[stub] chunk {request.chunk.index} from {request.chunk.start_seconds:.0f}s "
            f"to {request.chunk.end_seconds:.0f}s, language={request.language}."
        )
        if request.prior_context:
            text = f"{request.prior_context.strip()} {text}"
        return (
            TranscriptSegment(
                chunk_id=request.chunk.chunk_id,
                speaker_id=speaker_id,
                start_seconds=request.chunk.start_seconds,
                end_seconds=request.chunk.end_seconds,
                text=text,
                confidence=0.55 if speaker_id == "speaker_unknown" else 0.72,
            ),
        )

    def summarize(self, request: SummaryRequest) -> MeetingArtifact:
        transcript_text = " ".join(segment.text for segment in request.transcript_segments).strip()
        if not transcript_text:
            transcript_text = "No transcript content was produced."
        decisions = ("Review the transcript and replace stub provider output.",)
        action_items = (
            ActionItem(
                task="Wire the OpenAI provider to live transcription and summarization endpoints",
                owner=None,
                priority="high",
                confidence=0.9,
                evidence="Stub provider output",
            ),
        )
        return MeetingArtifact(
            meeting_id=request.meeting_id,
            language=request.language,
            summary=f"Stub summary for {request.title}.",
            meeting_minutes=transcript_text,
            decisions=decisions,
            action_items=action_items,
            risks=("Provider networking is not implemented yet.",),
            next_steps=("Integrate real audio upload and OpenAI API transport.",),
            provider_name=self.provider_name,
        )


def build_provider(
    provider_name: str,
    api_key: str | None,
    transcription_model: str,
    summary_model: str,
    base_url: str,
) -> MeetingAIProvider:
    if provider_name == "openai" and api_key:
        return OpenAIProviderAdapter(
            api_key=api_key,
            transcription_model=transcription_model,
            summary_model=summary_model,
            base_url=base_url,
        )
    return StubMeetingAIProvider()
