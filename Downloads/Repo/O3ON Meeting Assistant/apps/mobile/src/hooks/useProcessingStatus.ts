import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { MeetingStatusResponse } from "../types";

type ProcessingStatus = {
  data: MeetingStatusResponse | null;
  isProcessing: boolean;
  isReady: boolean;
  isFailed: boolean;
  error: string | null;
};

export function useProcessingStatus(
  token: string,
  meetingId: string,
  enabled: boolean,
  intervalMs = 4000
): ProcessingStatus {
  const [data, setData] = useState<MeetingStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function poll() {
      try {
        const status = await api.getStatus(token, meetingId);
        if (cancelled) return;
        setData(status);
        setError(null);

        const done = status.status === "ready" || status.status === "needs_review" || status.status === "failed";
        if (done && timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Status check failed");
      }
    }

    void poll();
    timerRef.current = setInterval(() => void poll(), intervalMs);

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [token, meetingId, enabled, intervalMs]);

  const status = data?.status;
  return {
    data,
    isProcessing: status === "processing" || status === "recording",
    isReady: status === "ready" || status === "needs_review",
    isFailed: status === "failed",
    error,
  };
}
