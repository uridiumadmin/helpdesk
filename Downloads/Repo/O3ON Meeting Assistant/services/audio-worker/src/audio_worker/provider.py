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


@dataclass(frozen=True, slots=True)
class DiarizationRequest:
    meeting_id: str
    language: str
    title: str
    transcript_segments: tuple[TranscriptSegment, ...]
    participants: tuple[MeetingParticipant, ...]


class MeetingAIProvider(Protocol):
    provider_name: str

    def transcribe(self, request: TranscriptionRequest) -> tuple[TranscriptSegment, ...]:
        raise NotImplementedError

    def summarize(self, request: SummaryRequest) -> MeetingArtifact:
        raise NotImplementedError

    def diarize_transcript(self, request: DiarizationRequest) -> tuple[TranscriptSegment, ...]:
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


def _build_multipart_body_with_repeated(
    fields: dict[str, str],
    file_field: str,
    file_path: Path,
    repeated_key: str,
    repeated_values: list[str],
) -> tuple[bytes, str]:
    """Like _build_multipart_body but also appends repeated form fields (e.g. known_speaker_names[])."""
    boundary = f"----o3on-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    line_break = b"\r\n"

    for key, value in fields.items():
        chunks.append(f"--{boundary}".encode("utf-8"))
        chunks.append(line_break)
        chunks.append(f'Content-Disposition: form-data; name="{key}"'.encode("utf-8"))
        chunks.append(line_break)
        chunks.append(line_break)
        chunks.append(str(value).encode("utf-8"))
        chunks.append(line_break)

    for value in repeated_values:
        chunks.append(f"--{boundary}".encode("utf-8"))
        chunks.append(line_break)
        chunks.append(f'Content-Disposition: form-data; name="{repeated_key}"'.encode("utf-8"))
        chunks.append(line_break)
        chunks.append(line_break)
        chunks.append(str(value).encode("utf-8"))
        chunks.append(line_break)

    chunks.append(f"--{boundary}".encode("utf-8"))
    chunks.append(line_break)
    chunks.append(
        f'Content-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"'.encode("utf-8")
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

    @property
    def _uses_diarize_model(self) -> bool:
        return "diarize" in self.transcription_model

    def _build_diarize_fields(self, request: TranscriptionRequest) -> tuple[dict[str, str], list[str]]:
        fields: dict[str, str] = {
            "model": self.transcription_model,
            "language": request.language,
            "response_format": "diarized_json",
            "chunking_strategy": "auto",
        }
        # known_speaker_names requires matching known_speaker_references (audio clips).
        # Without enrollment audio we cannot provide references, so we skip names
        # and let the model assign speaker_0, speaker_1, etc.
        speaker_names: list[str] = []
        return fields, speaker_names

    def _build_verbose_fields(self, request: TranscriptionRequest) -> dict[str, str]:
        return {
            "model": self.transcription_model,
            "language": request.language,
            "response_format": "verbose_json",
            "timestamp_granularities[]": "segment",
            "prompt": (
                f"Serbian meeting audio. Participants: "
                f"{', '.join(p.display_name for p in request.participants) or 'unknown'}. "
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

        if self._uses_diarize_model:
            fields, speaker_names = self._build_diarize_fields(request)
            if speaker_names:
                body, boundary = _build_multipart_body_with_repeated(
                    fields, "file", source, "known_speaker_names[]", speaker_names
                )
            else:
                body, boundary = _build_multipart_body(fields, "file", source)
        else:
            fields = self._build_verbose_fields(request)
            body, boundary = _build_multipart_body(fields, "file", source)

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
            with urllib_request.urlopen(http_request, timeout=300) as response:
                data = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            raise RuntimeError(f"OpenAI transcription failed with status {exc.code}.") from exc

        # Handle diarized_json response format
        if self._uses_diarize_model:
            return self._parse_diarized_response(data, request)

        # Handle verbose_json response format (non-diarize models)
        return self._parse_verbose_response(data, request)

    def _parse_diarized_response(
        self, data: dict, request: TranscriptionRequest
    ) -> tuple[TranscriptSegment, ...]:
        # diarized_json returns: {segments: [{speaker, text, start, end}, ...]}
        raw_segments = data.get("segments") or []
        if not raw_segments:
            text = str(data.get("text") or "").strip()
            if not text:
                raise RuntimeError("OpenAI diarized transcription returned no segments.")
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

        # Map speaker names to participant labels
        name_to_label: dict[str, str] = {}
        for p in request.participants:
            name_to_label[p.display_name] = p.speaker_label or p.participant_id
            name_to_label[p.display_name.lower()] = p.speaker_label or p.participant_id

        chunk_offset = request.chunk.start_seconds
        segments: list[TranscriptSegment] = []
        for idx, seg in enumerate(raw_segments):
            seg_text = str(seg.get("text", "")).strip()
            if not seg_text:
                continue
            raw_speaker = str(seg.get("speaker", ""))
            speaker_id = name_to_label.get(raw_speaker, name_to_label.get(raw_speaker.lower(), raw_speaker or "speaker_unknown"))
            segments.append(
                TranscriptSegment(
                    chunk_id=f"{request.chunk.chunk_id}-seg-{idx + 1:03d}",
                    speaker_id=speaker_id,
                    start_seconds=chunk_offset + float(seg.get("start", 0)),
                    end_seconds=chunk_offset + float(seg.get("end", 0)),
                    text=seg_text,
                    confidence=0.92,
                )
            )
        return tuple(segments) if segments else (
            TranscriptSegment(
                chunk_id=request.chunk.chunk_id,
                speaker_id=request.speaker_hint or "speaker_unknown",
                start_seconds=request.chunk.start_seconds,
                end_seconds=request.chunk.end_seconds,
                text=str(data.get("text", "")),
                confidence=0.8,
            ),
        )

    def _parse_verbose_response(
        self, data: dict, request: TranscriptionRequest
    ) -> tuple[TranscriptSegment, ...]:
        full_text = str(data.get("text") or "").strip()
        if not full_text:
            raise RuntimeError("OpenAI transcription returned empty text.")

        raw_segments = data.get("segments") or []
        if raw_segments:
            segments: list[TranscriptSegment] = []
            chunk_offset = request.chunk.start_seconds
            for idx, seg in enumerate(raw_segments):
                seg_text = str(seg.get("text", "")).strip()
                if not seg_text:
                    continue
                segments.append(
                    TranscriptSegment(
                        chunk_id=f"{request.chunk.chunk_id}-seg-{idx + 1:03d}",
                        speaker_id=request.speaker_hint or "speaker_unknown",
                        start_seconds=chunk_offset + float(seg.get("start", 0)),
                        end_seconds=chunk_offset + float(seg.get("end", 0)),
                        text=seg_text,
                        confidence=float(seg.get("avg_logprob", -0.3)) + 1.3,
                    )
                )
            if segments:
                return tuple(segments)

        return (
            TranscriptSegment(
                chunk_id=request.chunk.chunk_id,
                speaker_id=request.speaker_hint or "speaker_unknown",
                start_seconds=request.chunk.start_seconds,
                end_seconds=request.chunk.end_seconds,
                text=full_text,
                confidence=0.9,
            ),
        )

    @staticmethod
    def _parse_confidence(value: object) -> float:
        if isinstance(value, (int, float)):
            return float(value)
        text = str(value).strip().lower()
        mapping = {"high": 0.9, "medium": 0.6, "med": 0.6, "low": 0.3, "very high": 0.95, "very low": 0.1}
        if text in mapping:
            return mapping[text]
        try:
            return float(text)
        except ValueError:
            return 0.5

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
                confidence=self._parse_confidence(item.get("confidence", 0.0)),
                evidence=item.get("evidence"),
            )
            for item in summary_payload.get("action_items", [])
            if isinstance(item, dict)
        )

        def _ensure_list(value: object) -> list:
            if isinstance(value, list):
                return value
            if isinstance(value, str) and value.strip():
                return [value.strip()]
            return []

        return MeetingArtifact(
            meeting_id=request.meeting_id,
            language=request.language,
            summary=str(summary_payload.get("summary", "")).strip() or f"Summary for {request.title}",
            meeting_minutes=str(summary_payload.get("meeting_minutes", "")).strip(),
            decisions=tuple(str(item) for item in _ensure_list(summary_payload.get("decisions", []))),
            action_items=action_items,
            risks=tuple(str(item) for item in _ensure_list(summary_payload.get("risks", []))),
            next_steps=tuple(str(item) for item in _ensure_list(summary_payload.get("next_steps", []))),
            provider_name=self.provider_name,
        )

    def diarize_transcript(self, request: DiarizationRequest) -> tuple[TranscriptSegment, ...]:
        if not self.api_key:
            raise NotImplementedError("OPENAI_API_KEY is not configured.")

        participant_names = [p.display_name for p in request.participants]
        if not participant_names:
            return request.transcript_segments

        numbered_lines = []
        for idx, seg in enumerate(request.transcript_segments):
            numbered_lines.append(
                f"[{idx}] ({seg.start_seconds:.1f}s-{seg.end_seconds:.1f}s): {seg.text}"
            )
        transcript_block = "\n".join(numbered_lines)

        payload = json.dumps({
            "model": self.summary_model,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a speaker diarization assistant. You will receive a transcript "
                        "of a meeting with numbered segments and a list of participant names. "
                        "Your job is to assign a speaker to each segment based on context, "
                        "speech patterns, who is being addressed, and conversational flow. "
                        "Return strict JSON with key 'assignments': an array of objects, "
                        "each with 'index' (int) and 'speaker' (string, one of the participant names). "
                        "If you are uncertain, pick the most likely speaker. "
                        "Use ONLY the provided participant names."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Meeting: {request.title}\n"
                        f"Language: {request.language}\n"
                        f"Participants: {', '.join(participant_names)}\n\n"
                        f"Transcript:\n{transcript_block}\n\n"
                        "Return JSON with 'assignments' array."
                    ),
                },
            ],
        }).encode("utf-8")

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
            print(f"[diarize] GPT diarization failed with status {exc.code}, keeping original speakers")
            return request.transcript_segments

        try:
            content = _chat_message_to_text(data)
            result = json.loads(_extract_json_blob(content))
            assignments = {
                int(item["index"]): str(item["speaker"])
                for item in result.get("assignments", [])
                if isinstance(item, dict) and "index" in item and "speaker" in item
            }
        except (ValueError, KeyError):
            print("[diarize] GPT diarization returned invalid JSON, keeping original speakers")
            return request.transcript_segments

        # Build name→label lookup
        name_to_label = {}
        for p in request.participants:
            name_to_label[p.display_name] = p.speaker_label or p.participant_id

        diarized: list[TranscriptSegment] = []
        for idx, seg in enumerate(request.transcript_segments):
            speaker_name = assignments.get(idx)
            if speaker_name:
                speaker_id = name_to_label.get(speaker_name, speaker_name)
            else:
                speaker_id = seg.speaker_id
            diarized.append(
                TranscriptSegment(
                    chunk_id=seg.chunk_id,
                    speaker_id=speaker_id,
                    start_seconds=seg.start_seconds,
                    end_seconds=seg.end_seconds,
                    text=seg.text,
                    confidence=min(seg.confidence + 0.05, 1.0) if speaker_name else seg.confidence,
                )
            )
        return tuple(diarized)


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

    def diarize_transcript(self, request: DiarizationRequest) -> tuple[TranscriptSegment, ...]:
        return request.transcript_segments


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
