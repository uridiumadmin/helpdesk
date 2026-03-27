from __future__ import annotations

from dataclasses import dataclass
import re

from audio_worker.models import ActionItem, MeetingArtifact, MeetingParticipant, TranscriptSegment
from audio_worker.provider import MeetingAIProvider, SummaryRequest


@dataclass(frozen=True, slots=True)
class SummaryPlan:
    language: str
    title: str


def _infer_decisions(text: str) -> tuple[str, ...]:
    phrases = []
    for sentence in re.split(r"[.!?]\s+", text):
        lowered = sentence.lower()
        if any(marker in lowered for marker in ("odlučeno", "dogovoreno", "usvojeno")):
            phrases.append(sentence.strip())
    return tuple(dict.fromkeys(phrases))


def _infer_action_items(text: str) -> tuple[str, ...]:
    phrases = []
    for sentence in re.split(r"[.!?]\s+", text):
        lowered = sentence.lower()
        if any(marker in lowered for marker in ("treba", "zadužen", "rok", "akcija")):
            phrases.append(sentence.strip())
    return tuple(dict.fromkeys(phrases))


def summarize_transcript(
    provider: MeetingAIProvider,
    meeting_id: str,
    language: str,
    title: str,
    transcript_segments: tuple[TranscriptSegment, ...],
    participants: tuple[MeetingParticipant, ...],
    notes: str | None = None,
) -> MeetingArtifact:
    plan = SummaryPlan(language=language, title=title)
    request = SummaryRequest(
        meeting_id=meeting_id,
        language=plan.language,
        title=plan.title,
        transcript_segments=transcript_segments,
        participants=participants,
        notes=notes,
    )
    try:
        return provider.summarize(request)
    except NotImplementedError:
        transcript_text = " ".join(segment.text for segment in transcript_segments).strip()
        if not transcript_text:
            transcript_text = "No transcript content was produced."
        decisions = _infer_decisions(transcript_text) or (
            "No explicit decision statements were detected.",
        )
        action_item_lines = _infer_action_items(transcript_text) or (
            "Review transcript and extract follow-up actions.",
        )
        action_items = tuple(
            ActionItem(
                task=line,
                owner=None,
                due_date=None,
                priority="medium",
                confidence=0.5,
                evidence=line,
            )
            for line in action_item_lines
        )
        return MeetingArtifact(
            meeting_id=meeting_id,
            language=language,
            summary=f"Fallback summary for {title}.",
            meeting_minutes=transcript_text,
            decisions=decisions,
            action_items=action_items,
            risks=("Summary was generated without a live AI provider.",),
            next_steps=("Replace fallback heuristics with provider-backed synthesis.",),
            provider_name=getattr(provider, "provider_name", "unknown"),
        )
