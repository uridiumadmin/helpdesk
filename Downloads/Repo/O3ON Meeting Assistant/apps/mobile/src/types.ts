export type AuthSession = {
  accessToken: string;
  refreshToken?: string | null;
  user: AuthUser;
  organization?: OrganizationSummary | null;
};

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  role: "owner" | "admin" | "member";
};

export type OrganizationSummary = {
  id: string;
  name: string;
};

export type MeetingStatus =
  | "draft"
  | "recording"
  | "processing"
  | "ready"
  | "needs_review"
  | "failed";

export type Meeting = {
  id: string;
  title: string;
  startsAt: string;
  durationMinutes: number;
  status: MeetingStatus;
  language: "sr-RS";
  participants: Participant[];
  summary?: string;
  actionItems?: ActionItem[];
};

export type Participant = {
  id: string;
  name: string;
  email?: string;
  speakerLabel?: string;
  enrollmentStatus: "pending" | "enrolled" | "needs_retry";
};

export type ActionItem = {
  id: string;
  title: string;
  owner?: string | null;
  dueDate?: string | null;
  confidence: number;
};

export type TranscriptSegment = {
  id: string;
  speakerLabel: string;
  speakerName?: string | null;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number;
};

export type MeetingArtifact = {
  meetingId: string;
  transcript: TranscriptSegment[];
  summary: string;
  minutes: string[];
  decisions: string[];
  risks?: string[];
  openQuestions?: string[];
  actionItems: ActionItem[];
  needsReview: boolean;
};

export type UploadSession = {
  uploadId: string;
  chunkSizeBytes: number;
  uploadUrl: string;
  expiresAt: string;
};

export type MeetingStatusResponse = {
  id: string;
  status: MeetingStatus;
  participants: number;
  uploadCompletedAt?: string;
  uploadFileName?: string;
  processingReady?: boolean;
};

export type RecordingUploadResult = {
  uploadId: string;
  fileName: string;
  bytesStored: number;
};
