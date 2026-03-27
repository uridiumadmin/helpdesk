export type MeetingStatus =
  | "draft"
  | "recording"
  | "processing"
  | "ready"
  | "needs_review"
  | "failed";

export type Role = "owner" | "admin" | "member";

export interface UserIdentity {
  id: string;
  email: string;
  orgId: string;
  role: Role;
}

export interface Participant {
  id: string;
  meetingId: string;
  name: string;
  email?: string;
  speakerLabel?: string;
  enrollmentStatus: "pending" | "enrolled" | "needs_retry";
}

export interface SpeakerProfile {
  participantId: string;
  voiceprintId: string;
  sampleDurationSeconds: number;
  createdAt: string;
}

export interface TranscriptSegment {
  id: string;
  speakerLabel: string;
  speakerName?: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number;
}

export interface ActionItem {
  id: string;
  title: string;
  owner?: string;
  dueDate?: string;
  confidence: number;
}

export interface MeetingArtifact {
  meetingId: string;
  transcript: TranscriptSegment[];
  summary: string;
  minutes: string[];
  decisions: string[];
  risks?: string[];
  openQuestions?: string[];
  actionItems: ActionItem[];
  needsReview: boolean;
}

export interface Meeting {
  id: string;
  title: string;
  startsAt: string;
  durationMinutes: number;
  language: "sr-RS";
  status: MeetingStatus;
  participants: Participant[];
  summary?: string;
  actionItems?: ActionItem[];
  artifact?: MeetingArtifact;
}
