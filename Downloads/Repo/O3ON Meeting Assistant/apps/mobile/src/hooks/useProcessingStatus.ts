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
  initialIntervalMs = 2000,
  maxIntervalMs = 60000
): ProcessingStatus {
  const [data, setData] = useState<MeetingStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef(initialIntervalMs);
  const lastStatusRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    intervalRef.current = initialIntervalMs;
    lastStatusRef.current = undefined;

    function scheduleNext() {
      if (cancelled) return;
      timerRef.current = setTimeout(() => void poll(), intervalRef.current);
    }

    async function poll() {
      try {
        const status = await api.getStatus(token, meetingId);
        if (cancelled) return;
        setData(status);
        setError(null);

        // Reset interval when the status changes
        if (lastStatusRef.current !== undefined && status.status !== lastStatusRef.current) {
          intervalRef.current = initialIntervalMs;
        } else {
          intervalRef.current = Math.min(intervalRef.current * 2, maxIntervalMs);
        }
        lastStatusRef.current = status.status;

        const done = status.status === "ready" || status.status === "needs_review" || status.status === "failed";
        if (!done) {
          scheduleNext();
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Status check failed");
        // Back off on errors too
        intervalRef.current = Math.min(intervalRef.current * 2, maxIntervalMs);
        scheduleNext();
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [token, meetingId, enabled, initialIntervalMs, maxIntervalMs]);

  const status = data?.status;
  return {
    data,
    isProcessing: status === "processing" || status === "recording" || status === "processing_chunks" || status === "summarizing",
    isReady: status === "ready" || status === "needs_review",
    isFailed: status === "failed",
    error,
  };
}
