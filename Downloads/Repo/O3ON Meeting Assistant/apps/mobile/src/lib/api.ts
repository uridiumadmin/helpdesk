import { Platform } from "react-native";
import { appConfig } from "../config";
import type {
  ActionItem,
  AudioFile,
  AuthSession,
  Meeting,
  MeetingArtifact,
  MeetingShare,
  MeetingStatusResponse,
  Participant,
  RecordingUploadResult,
  SpeakerMapping,
  TranscriptSegment,
  UploadSession,
  UserProfile
} from "../types";

type RequestInitWithAuth = RequestInit & {
  token?: string | null;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let onAuthExpiredCallback: (() => void) | null = null;

export function setOnAuthExpired(callback: (() => void) | null) {
  onAuthExpiredCallback = callback;
}

async function request<T>(path: string, init: RequestInitWithAuth = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }

  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    // On 401, trigger auth expiry callback (auto-logout)
    if (response.status === 401 && init.token && onAuthExpiredCallback) {
      onAuthExpiredCallback();
    }
    const text = await response.text();
    throw new ApiError(text || response.statusText, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function toAbsoluteUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${appConfig.apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export const api = {
  signIn(payload: { email: string; password: string }) {
    return request<AuthSession>("/v1/auth/session", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  signOut(token: string) {
    return request<void>("/v1/auth/session", {
      method: "DELETE",
      token
    });
  },
  getProfile(token: string) {
    return request<UserProfile>("/v1/auth/me", { token });
  },
  updateProfile(token: string, data: { fullName?: string }) {
    return request<UserProfile>("/v1/auth/me", {
      method: "PATCH",
      token,
      body: JSON.stringify(data),
    });
  },
  listMeetings(token: string) {
    return request<Meeting[]>("/v1/meetings", { token });
  },
  createMeeting(
    token: string,
    payload: Pick<Meeting, "title" | "startsAt" | "durationMinutes"> & {
      participantNames: string[];
    }
  ) {
    return request<Meeting>("/v1/meetings", {
      method: "POST",
      token,
      body: JSON.stringify(payload)
    });
  },
  updateMeeting(
    token: string,
    meetingId: string,
    data: { title?: string; startsAt?: string; durationMinutes?: number }
  ) {
    return request<Meeting>(`/v1/meetings/${meetingId}`, {
      method: "PUT",
      token,
      body: JSON.stringify(data)
    });
  },
  startRecording(token: string, meetingId: string) {
    return request<{ jobId: string }>(`/v1/meetings/${meetingId}/recording/start`, {
      method: "POST",
      token
    });
  },
  requestUploadSession(token: string, meetingId: string) {
    return request<UploadSession>(`/v1/meetings/${meetingId}/uploads/session`, {
      method: "POST",
      token,
      body: JSON.stringify({ filename: `meeting-${meetingId}.m4a` })
    });
  },
  async uploadRecordingFile(token: string, meetingId: string, uploadUrl: string, recordingUri: string) {
    const formData = new FormData();

    if (Platform.OS === "web") {
      // On web, recordingUri is a blob: URL — fetch it to get the real blob
      const blob = await fetch(recordingUri).then((r) => r.blob());
      // Browser records WebM, not M4A — use correct extension based on MIME type
      const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("ogg") ? "ogg" : "m4a";
      formData.append("file", blob, `meeting-${meetingId}.${ext}`);
    } else {
      // On native (iOS/Android), expo-av records M4A
      formData.append("file", {
        uri: recordingUri,
        name: `meeting-${meetingId}.m4a`,
        type: "audio/x-m4a"
      } as never);
    }

    const response = await fetch(toAbsoluteUrl(uploadUrl), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(text || response.statusText, response.status);
    }

    return (await response.json()) as RecordingUploadResult;
  },
  async uploadAudioFile(token: string, meetingId: string, uploadUrl: string, file: File) {
    const formData = new FormData();
    formData.append("file", file, file.name);

    const response = await fetch(toAbsoluteUrl(uploadUrl), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(text || response.statusText, response.status);
    }

    return (await response.json()) as RecordingUploadResult;
  },
  completeUpload(token: string, meetingId: string, uploadId: string) {
    return request<{ processingJobId: string }>(`/v1/meetings/${meetingId}/uploads/complete`, {
      method: "POST",
      token,
      body: JSON.stringify({ uploadId })
    });
  },
  completeUploadWithDuration(
    token: string,
    meetingId: string,
    uploadId: string,
    durationSeconds: number
  ) {
    return request<{ processingJobId: string }>(`/v1/meetings/${meetingId}/uploads/complete`, {
      method: "POST",
      token,
      body: JSON.stringify({ uploadId, durationSeconds })
    });
  },
  getStatus(token: string, meetingId: string) {
    return request<MeetingStatusResponse>(`/v1/meetings/${meetingId}/status`, { token });
  },
  getArtifacts(token: string, meetingId: string) {
    return request<MeetingArtifact>(`/v1/meetings/${meetingId}/artifacts`, { token });
  },
  getPartialTranscript(token: string, meetingId: string) {
    return request<{
      segments: Array<{ speaker: string; text: string; start: number; end: number; confidence: number }>;
      chunksCompleted: number;
      chunksTotal: number;
    }>(`/v1/meetings/${meetingId}/partial-transcript`, { token });
  },
  addActionItems(token: string, meetingId: string, items: ActionItem[]) {
    return request<void>(`/v1/meetings/${meetingId}/action-items`, {
      method: "PUT",
      token,
      body: JSON.stringify({ items })
    });
  },
  // Sharing
  shareMeeting(token: string, meetingId: string, email: string) {
    return request<MeetingShare>(`/v1/meetings/${meetingId}/shares`, {
      method: "POST",
      token,
      body: JSON.stringify({ email }),
    });
  },
  listShares(token: string, meetingId: string) {
    return request<MeetingShare[]>(`/v1/meetings/${meetingId}/shares`, { token });
  },
  revokeShare(token: string, meetingId: string, shareId: string) {
    return request<void>(`/v1/meetings/${meetingId}/shares/${shareId}`, {
      method: "DELETE",
      token,
    });
  },

  // Admin user management
  listUsers(token: string) {
    return request<Array<{ id: string; email: string; fullName: string | null; role: string; createdAt: string }>>(
      "/v1/auth/users", { token }
    );
  },
  createUser(token: string, data: { email: string; fullName?: string; role?: string }) {
    return request<{ id: string; email: string; fullName: string | null; role: string; generatedPassword: string }>(
      "/v1/auth/users", { method: "POST", token, body: JSON.stringify(data) }
    );
  },

  // Delete
  deleteMeeting(token: string, meetingId: string) {
    return request<{ deleted: boolean }>(`/v1/meetings/${meetingId}`, {
      method: "DELETE",
      token,
    });
  },

  // Speaker mappings
  getSpeakerMappings(token: string, meetingId: string) {
    return request<SpeakerMapping[]>(`/v1/meetings/${meetingId}/speakers`, { token });
  },
  updateSpeakerMappings(token: string, meetingId: string, mappings: SpeakerMapping[]) {
    return request<{ updated: number }>(`/v1/meetings/${meetingId}/speakers`, {
      method: "PUT",
      token,
      body: JSON.stringify({ mappings }),
    });
  },

  // Audio
  getAudioFiles(token: string, meetingId: string) {
    return request<AudioFile[]>(`/v1/meetings/${meetingId}/audio`, { token });
  },

  async exportMeeting(token: string, meetingId: string): Promise<string> {
    const response = await fetch(`${appConfig.apiBaseUrl}/v1/meetings/${meetingId}/export`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/markdown",
      },
    });
    if (!response.ok) {
      if (response.status === 401 && token && onAuthExpiredCallback) {
        onAuthExpiredCallback();
      }
      const text = await response.text();
      throw new ApiError(text || response.statusText, response.status);
    }
    return response.text();
  },

  ping(token: string) {
    return request<{ ok: boolean }>("/v1/ping", { token });
  }
};

export const mockArtifacts = (): MeetingArtifact => {
  const transcript: TranscriptSegment[] = [
    {
      id: "seg-1",
      speakerLabel: "speaker-1",
      speakerName: "Miloš",
      startMs: 0,
      endMs: 18000,
      text: "Dogovorili smo prioritet za onboarding, stabilan login i prvi upload pipeline.",
      confidence: 0.92
    },
    {
      id: "seg-2",
      speakerLabel: "speaker-2",
      speakerName: "Jelena",
      startMs: 18000,
      endMs: 42000,
      text: "Treba da chunking radi sa overlap-om i da se speaker mapping preslikava po enrollment-u.",
      confidence: 0.89
    }
  ];

  return {
    meetingId: "meeting-1",
    transcript,
    summary:
      "Tim je uskladio plan za mobile capture, speaker-aware transcribe i sigurnu obradu preko server-side AI sloja.",
    minutes: [
      "Dogovoren je mobile first pristup sa keep-awake snimanjem.",
      "Dijarizacija i enrollment će se koristiti za mapiranje učesnika.",
      "AI provider ključevi ostaju samo na backendu."
    ],
    decisions: ["V1 je post-meeting processing, ne live stream."],
    actionItems: [
      {
        id: "act-1",
        title: "Implementirati Auth0/SSO integraciju na backendu.",
        owner: "Backend",
        dueDate: null,
        confidence: 0.94
      },
      {
        id: "act-2",
        title: "Povezati upload chunking sa worker pipeline-om.",
        owner: "Platform",
        dueDate: null,
        confidence: 0.91
      }
    ],
    needsReview: false
  };
};
