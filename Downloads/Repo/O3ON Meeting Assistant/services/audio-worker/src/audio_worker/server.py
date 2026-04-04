from __future__ import annotations

import hashlib
import hmac
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import time
import uuid

from audio_worker.config import WorkerSettings
from audio_worker.engine import MeetingPipeline
from audio_worker.models import AudioSource, MeetingParticipant, ProcessingRequest, SpeakerEnrollment, TranscriptSegment
from audio_worker.provider import build_provider


def build_health_payload(settings: WorkerSettings) -> dict:
    return {
        "service": settings.service_name,
        "environment": settings.environment,
        "status": "ok",
        "provider": settings.provider_name,
        "language": settings.language,
        "transcription_model": settings.transcription_model,
        "summary_model": settings.summary_model,
    }


def _parse_processing_request(payload: dict) -> ProcessingRequest:
    audio_source_payload = payload["audio_source"]
    participants_payload = payload.get("participants", [])
    enrollments_payload = payload.get("enrollments", [])

    return ProcessingRequest(
        meeting_id=payload["meeting_id"],
        title=payload["title"],
        organizer_id=payload["organizer_id"],
        audio_source=AudioSource(
            source_id=audio_source_payload["source_id"],
            uri=audio_source_payload["uri"],
            duration_seconds=audio_source_payload.get("duration_seconds"),
            sample_rate_hz=audio_source_payload.get("sample_rate_hz"),
            channels=audio_source_payload.get("channels"),
            language=audio_source_payload.get("language", "sr"),
        ),
        participants=tuple(
            MeetingParticipant(
                participant_id=item["participant_id"],
                display_name=item["display_name"],
                email=item.get("email"),
                locale=item.get("locale", "sr-RS"),
                speaker_label=item.get("speaker_label"),
            )
            for item in participants_payload
        ),
        enrollments=tuple(
            SpeakerEnrollment(
                participant_id=item["participant_id"],
                enrollment_sample_id=item["enrollment_sample_id"],
                sample_uri=item["sample_uri"],
                embedding_ref=item.get("embedding_ref"),
                confidence=item.get("confidence"),
            )
            for item in enrollments_payload
        ),
        language=payload.get("language", "sr"),
        chunk_seconds=int(payload.get("chunk_seconds", 45)),
        chunk_overlap_seconds=int(payload.get("chunk_overlap_seconds", 5)),
        notes=payload.get("notes"),
    )


def _verify_worker_signature(settings: WorkerSettings, headers, raw_body: bytes) -> bool:
    secret = settings.worker_shared_secret
    if not secret:
        return settings.environment == "development"

    timestamp = headers.get("x-o3on-timestamp")
    signature = headers.get("x-o3on-signature")
    if not timestamp or not signature:
        return False

    try:
        timestamp_value = int(timestamp)
    except ValueError:
        return False

    if abs(int(time.time()) - timestamp_value) > 300:
        return False

    expected = hmac.new(
        secret.encode("utf-8"),
        timestamp.encode("utf-8") + b"." + raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def _resolve_allowed_path(candidate: str, allowed_root: Path) -> str:
    resolved = Path(candidate).expanduser().resolve()
    safe_root = allowed_root.resolve()
    try:
        resolved.relative_to(safe_root)
    except ValueError as exc:
        raise PermissionError("Requested audio path is outside the allowed worker storage root.") from exc
    if not resolved.exists() or not resolved.is_file():
        raise FileNotFoundError("Requested audio path does not exist.")
    return str(resolved)


def _sanitize_processing_request(processing_request: ProcessingRequest, settings: WorkerSettings) -> ProcessingRequest:
    allowed_root = settings.resolved_allowed_source_root
    audio_source = processing_request.audio_source
    sanitized_source = AudioSource(
        source_id=audio_source.source_id,
        uri=_resolve_allowed_path(audio_source.uri, allowed_root),
        duration_seconds=audio_source.duration_seconds,
        sample_rate_hz=audio_source.sample_rate_hz,
        channels=audio_source.channels,
        language=audio_source.language,
        created_at=audio_source.created_at,
    )
    sanitized_enrollments = tuple(
        SpeakerEnrollment(
            participant_id=item.participant_id,
            enrollment_sample_id=item.enrollment_sample_id,
            sample_uri=_resolve_allowed_path(item.sample_uri, allowed_root),
            embedding_ref=item.embedding_ref,
            confidence=item.confidence,
        )
        for item in processing_request.enrollments
    )
    return ProcessingRequest(
        meeting_id=processing_request.meeting_id,
        title=processing_request.title,
        organizer_id=processing_request.organizer_id,
        audio_source=sanitized_source,
        participants=processing_request.participants,
        enrollments=sanitized_enrollments,
        language=processing_request.language,
        chunk_seconds=processing_request.chunk_seconds,
        chunk_overlap_seconds=processing_request.chunk_overlap_seconds,
        notes=processing_request.notes,
    )


def _handler_factory(settings: WorkerSettings) -> type[BaseHTTPRequestHandler]:
    provider = build_provider(
        provider_name=settings.provider_name,
        api_key=settings.openai_api_key,
        transcription_model=settings.transcription_model,
        summary_model=settings.summary_model,
        base_url=settings.openai_base_url,
    )
    payload = build_health_payload(settings)
    payload["provider"] = provider.provider_name
    pipeline = MeetingPipeline(settings=settings, provider=provider)

    class WorkerHandler(BaseHTTPRequestHandler):
        def _send_json(self, status: HTTPStatus, body: dict) -> None:
            data = json.dumps(body, ensure_ascii=True).encode("utf-8")
            self.send_response(status.value)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802
            if self.path in {"/healthz", "/readyz"}:
                self._send_json(HTTPStatus.OK, payload)
                return
            self._send_json(HTTPStatus.NOT_FOUND, {"status": "not_found", "path": self.path})

        def _read_and_verify(self) -> bytes | None:
            """Read request body and verify HMAC signature. Returns raw bytes or None on failure."""
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 1024 * 1024:
                self._send_json(
                    HTTPStatus.BAD_REQUEST, {"status": "error", "message": "Invalid request body."}
                )
                return None
            raw = self.rfile.read(content_length)
            if not _verify_worker_signature(settings, self.headers, raw):
                self._send_json(
                    HTTPStatus.UNAUTHORIZED,
                    {"status": "error", "message": "Unauthorized worker request."},
                )
                return None
            return raw

        def do_POST(self) -> None:  # noqa: N802
            if self.path == "/process":
                self._handle_process()
            elif self.path == "/transcribe-chunk":
                self._handle_transcribe_chunk()
            elif self.path == "/summarize":
                self._handle_summarize()
            else:
                self._send_json(HTTPStatus.NOT_FOUND, {"status": "not_found", "path": self.path})

        def _handle_process(self) -> None:
            raw = self._read_and_verify()
            if raw is None:
                return
            try:
                request_payload = json.loads(raw.decode("utf-8"))
                processing_request = _sanitize_processing_request(
                    _parse_processing_request(request_payload), settings
                )
                result = pipeline.process(processing_request)
                self._send_json(HTTPStatus.OK, result.to_dict())
            except Exception as exc:  # noqa: BLE001
                request_id = uuid.uuid4().hex
                print(f"[audio-worker] request_id={request_id} error={type(exc).__name__}: {exc}")
                self._send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {
                        "status": "error",
                        "request_id": request_id,
                        "message": "Processing failed.",
                    },
                )

        def _handle_transcribe_chunk(self) -> None:
            raw = self._read_and_verify()
            if raw is None:
                return
            try:
                payload = json.loads(raw.decode("utf-8"))
                # Resolve audio path
                allowed_root = settings.resolved_allowed_source_root
                audio_uri = _resolve_allowed_path(payload["audio_uri"], allowed_root)

                participants = tuple(
                    MeetingParticipant(
                        participant_id=p["id"],
                        display_name=p["name"],
                        speaker_label=p.get("speaker_label"),
                    )
                    for p in payload.get("participants", [])
                )

                result = pipeline.transcribe_single_chunk(
                    meeting_id=payload["meeting_id"],
                    chunk_id=payload["chunk_id"],
                    title=payload.get("title", ""),
                    language=payload.get("language", "sr"),
                    audio_uri=audio_uri,
                    duration_seconds=float(payload.get("duration_seconds", 300)),
                    participants=participants,
                    prior_context=payload.get("prior_context", ""),
                )
                self._send_json(HTTPStatus.OK, result)
            except Exception as exc:  # noqa: BLE001
                request_id = uuid.uuid4().hex
                print(f"[audio-worker] transcribe-chunk request_id={request_id} error={type(exc).__name__}: {exc}")
                self._send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {
                        "status": "error",
                        "request_id": request_id,
                        "message": "Chunk transcription failed.",
                    },
                )

        def _handle_summarize(self) -> None:
            raw = self._read_and_verify()
            if raw is None:
                return
            try:
                payload = json.loads(raw.decode("utf-8"))
                participants = tuple(
                    MeetingParticipant(
                        participant_id=p["id"],
                        display_name=p["name"],
                        speaker_label=p.get("speaker_label"),
                    )
                    for p in payload.get("participants", [])
                )

                segments = tuple(
                    TranscriptSegment(
                        chunk_id=s.get("chunk_id", ""),
                        speaker_id=s.get("speaker", s.get("speaker_id", "speaker_unknown")),
                        start_seconds=float(s.get("start", s.get("start_seconds", 0))),
                        end_seconds=float(s.get("end", s.get("end_seconds", 0))),
                        text=s.get("text", ""),
                        confidence=float(s.get("confidence", 0.8)),
                    )
                    for s in payload.get("transcript_segments", [])
                )

                result = pipeline.summarize_transcript_only(
                    meeting_id=payload["meeting_id"],
                    title=payload.get("title", ""),
                    language=payload.get("language", "sr"),
                    transcript_segments=segments,
                    participants=participants,
                    notes=payload.get("notes", ""),
                )
                self._send_json(HTTPStatus.OK, result)
            except Exception as exc:  # noqa: BLE001
                request_id = uuid.uuid4().hex
                print(f"[audio-worker] summarize request_id={request_id} error={type(exc).__name__}: {exc}")
                self._send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {
                        "status": "error",
                        "request_id": request_id,
                        "message": "Summarization failed.",
                    },
                )

        def log_message(self, format: str, *args) -> None:  # noqa: A003
            return

    return WorkerHandler


def create_server(settings: WorkerSettings) -> ThreadingHTTPServer:
    handler = _handler_factory(settings)
    return ThreadingHTTPServer((settings.host, settings.port), handler)


def serve(settings: WorkerSettings) -> None:
    server = create_server(settings)
    try:
        server.serve_forever()
    finally:
        server.server_close()
