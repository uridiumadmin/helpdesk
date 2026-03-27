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
from audio_worker.models import AudioSource, MeetingParticipant, ProcessingRequest, SpeakerEnrollment
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

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/process":
                self._send_json(HTTPStatus.NOT_FOUND, {"status": "not_found", "path": self.path})
                return

            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 1024 * 1024:
                self._send_json(
                    HTTPStatus.BAD_REQUEST, {"status": "error", "message": "Invalid request body."}
                )
                return
            raw = self.rfile.read(content_length)
            if not _verify_worker_signature(settings, self.headers, raw):
                self._send_json(
                    HTTPStatus.UNAUTHORIZED,
                    {"status": "error", "message": "Unauthorized worker request."},
                )
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
