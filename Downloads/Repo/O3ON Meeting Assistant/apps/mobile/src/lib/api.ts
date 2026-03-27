import { appConfig } from "../config";
import type {
  ActionItem,
  AuthSession,
  Meeting,
  MeetingArtifact,
  MeetingStatusResponse,
  Participant,
  RecordingUploadResult,
  TranscriptSegment,
  UploadSession
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
    return request<AuthSession>("/v1/auth/me", { token });
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
    formData.append("file", {
      uri: recordingUri,
      name: `meeting-${meetingId}.m4a`,
      type: "audio/x-m4a"
    } as never);

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
  addActionItems(token: string, meetingId: string, items: ActionItem[]) {
    return request<void>(`/v1/meetings/${meetingId}/action-items`, {
      method: "PUT",
      token,
      body: JSON.stringify({ items })
    });
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
