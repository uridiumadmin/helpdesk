import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { Audio } from "expo-av";
import { PrimaryButton } from "../components/PrimaryButton";
import { useTheme } from "../theme/ThemeContext";
import { api } from "../lib/api";
import type { Meeting } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = "idle" | "recording" | "paused" | "uploading" | "stopped";

type ChunkInfo = {
  index: number;
  uri: string;
  durationSeconds: number;
  uploaded: boolean;
};

type Props = {
  meeting: Meeting;
  token: string;
  onDone: () => void;
  onBack: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Timer Circle Component
// ---------------------------------------------------------------------------

function TimerCircle({
  seconds,
  phase,
}: {
  seconds: number;
  phase: Phase;
}) {
  const { colors, isDark } = useTheme();
  const ringPulse = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (phase !== "recording") {
      ringPulse.setValue(1);
      ringOpacity.setValue(0.6);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ringPulse, {
            toValue: 1.08,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(ringOpacity, {
            toValue: 1,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(ringPulse, {
            toValue: 1,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(ringOpacity, {
            toValue: 0.4,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, ringPulse, ringOpacity]);

  const isRecording = phase === "recording";
  const isPaused = phase === "paused";
  const isUploading = phase === "uploading";

  const outerRingColor = isRecording
    ? colors.recording
    : isPaused
      ? colors.warning
      : isUploading
        ? colors.accent
        : colors.border;

  return (
    <View style={styles.timerContainer}>
      {/* Outer pulsing ring */}
      <Animated.View
        style={[
          styles.timerOuterRing,
          {
            borderColor: outerRingColor,
            opacity: isRecording ? ringOpacity : 0.5,
            transform: [{ scale: isRecording ? ringPulse : 1 }],
          },
        ]}
      />

      {/* Inner circle */}
      <View
        style={[
          styles.timerInnerCircle,
          {
            backgroundColor: isDark
              ? "rgba(255,255,255,0.04)"
              : "rgba(0,0,0,0.03)",
            borderColor: isRecording
              ? colors.recording
              : isPaused
                ? colors.warning
                : colors.border,
            borderWidth: isRecording || isPaused ? 3 : 1,
          },
          !isDark && {
            shadowColor: colors.shadow,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 1,
            shadowRadius: 20,
            elevation: 6,
          },
        ]}
      >
        <Text
          style={[
            styles.timer,
            {
              color: isRecording
                ? colors.recording
                : isPaused
                  ? colors.warning
                  : colors.text,
            },
          ]}
        >
          {formatTime(seconds)}
        </Text>

        {/* Upload progress inside circle */}
        {isUploading ? (
          <View style={styles.uploadInsideCircle}>
            <ActivityIndicator color={colors.accent} size="small" />
            <Text
              style={[styles.uploadProgressText, { color: colors.accent }]}
            >
              Otpremanje...
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// RecordingScreen
// ---------------------------------------------------------------------------

export function RecordingScreen({ meeting, token, onDone, onBack }: Props) {
  const { colors, isDark } = useTheme();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [uploadingChunkIndex, setUploadingChunkIndex] = useState<number | null>(
    null,
  );

  const recordingRef = useRef<Audio.Recording | null>(null);
  const chunkStartSecondsRef = useRef(0);
  const currentChunkIndexRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fade-in animation
  const fadeIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [fadeIn]);

  // ── Phase label / color ─────────────────────────────────────────────────

  function getPhaseLabel(): string {
    switch (phase) {
      case "idle":
        return "Spreman";
      case "recording":
        return "Snimanje...";
      case "paused":
        return "Pauzirano";
      case "uploading":
        return "Otpremanje...";
      case "stopped":
        return "Zavrseno";
    }
  }

  function getPhaseColor(): string {
    switch (phase) {
      case "idle":
        return colors.textMuted;
      case "recording":
        return colors.recording;
      case "paused":
        return colors.warning;
      case "uploading":
        return colors.accent;
      case "stopped":
        return colors.success;
    }
  }

  // Pulse animation for recording dot
  const pulseDotAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (phase !== "recording") {
      pulseDotAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseDotAnim, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseDotAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulseDotAnim]);

  // ── Keep-awake while recording or paused ────────────────────────────────

  useEffect(() => {
    if (phase === "recording" || phase === "paused") {
      void activateKeepAwakeAsync();
      return () => {
        deactivateKeepAwake();
      };
    }
  }, [phase]);

  // ── Timer (only ticks during "recording") ───────────────────────────────

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // ── Upload a single chunk (fire-and-forget safe) ────────────────────────

  const uploadChunk = useCallback(
    async (uri: string, durationSeconds: number, chunkIndex: number) => {
      try {
        const session = await api.requestUploadSession(token, meeting.id);
        await api.uploadRecordingFile(
          token,
          meeting.id,
          session.uploadUrl,
          uri,
        );
        // Fire-and-forget: completeUploadWithDuration triggers processing
        await api.completeUploadWithDuration(
          token,
          meeting.id,
          session.uploadId,
          durationSeconds,
        );

        // Mark chunk as uploaded
        if (isMountedRef.current) {
          setChunks((prev) =>
            prev.map((c) =>
              c.index === chunkIndex ? { ...c, uploaded: true } : c,
            ),
          );
        }
      } catch (cause) {
        // Log but don't crash — background upload failure
        if (isMountedRef.current) {
          console.warn(
            `Chunk ${chunkIndex} upload failed:`,
            cause instanceof Error ? cause.message : cause,
          );
        }
      }
    },
    [token, meeting.id],
  );

  // ── Start recording (first chunk or resume) ────────────────────────────

  const startRecordingChunk = useCallback(async () => {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    });

    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY,
    );
    await rec.startAsync();
    recordingRef.current = rec;
    chunkStartSecondsRef.current = seconds;
  }, [seconds]);

  // ── Start (initial) ────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    setError(null);
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Potrebna je dozvola za mikrofon.");
      }

      // Notify backend (best-effort)
      try {
        await api.startRecording(token, meeting.id);
      } catch {
        // Ignore — local recording still works
      }

      currentChunkIndexRef.current = 1;
      setChunks([]);
      setSeconds(0);

      await startRecordingChunk();
      setPhase("recording");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Nije moguce pokrenuti snimanje.",
      );
    }
  }, [token, meeting.id, startRecordingChunk]);

  // ── Stop current recording and return chunk info ───────────────────────

  const stopCurrentRecording = useCallback(async (): Promise<ChunkInfo | null> => {
    const rec = recordingRef.current;
    if (!rec) return null;

    try {
      await rec.stopAndUnloadAsync();
    } catch {
      // Already stopped
    }

    const uri = rec.getURI();
    recordingRef.current = null;

    if (!uri) return null;

    const chunkDuration = Math.max(seconds - chunkStartSecondsRef.current, 1);
    const chunkIndex = currentChunkIndexRef.current;

    const chunk: ChunkInfo = {
      index: chunkIndex,
      uri,
      durationSeconds: chunkDuration,
      uploaded: false,
    };

    setChunks((prev) => [...prev, chunk]);
    return chunk;
  }, [seconds]);

  // ── Pause ──────────────────────────────────────────────────────────────

  const handlePause = useCallback(async () => {
    setError(null);
    try {
      const chunk = await stopCurrentRecording();
      setPhase("paused");

      if (chunk) {
        // Upload chunk in background
        setUploadingChunkIndex(chunk.index);
        uploadChunk(chunk.uri, chunk.durationSeconds, chunk.index).finally(
          () => {
            if (isMountedRef.current) {
              setUploadingChunkIndex(null);
            }
          },
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Greska prilikom pauziranja.",
      );
    }
  }, [stopCurrentRecording, uploadChunk]);

  // ── Resume ─────────────────────────────────────────────────────────────

  const handleResume = useCallback(async () => {
    setError(null);
    try {
      currentChunkIndexRef.current += 1;
      await startRecordingChunk();
      setPhase("recording");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Nije moguce nastaviti snimanje.",
      );
    }
  }, [startRecordingChunk]);

  // ── Stop (final) ──────────────────────────────────────────────────────

  const handleStop = useCallback(async () => {
    setError(null);

    // If currently recording, stop and get the final chunk
    if (phase === "recording") {
      try {
        const chunk = await stopCurrentRecording();
        setPhase("uploading");

        if (chunk) {
          setUploadingChunkIndex(chunk.index);
          try {
            await uploadChunk(chunk.uri, chunk.durationSeconds, chunk.index);
          } catch {
            // Upload failure logged inside uploadChunk
          }
          if (isMountedRef.current) {
            setUploadingChunkIndex(null);
          }
        }

        setPhase("stopped");
        onDone();
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Greska prilikom zaustavljanja.",
        );
        setPhase("paused");
      }
      return;
    }

    // If paused, no active recording to stop — just navigate
    if (phase === "paused") {
      setPhase("stopped");
      onDone();
    }
  }, [phase, stopCurrentRecording, uploadChunk, onDone]);

  // ── Derived state ─────────────────────────────────────────────────────

  const isIdle = phase === "idle";
  const isRecording = phase === "recording";
  const isPaused = phase === "paused";
  const isUploading = phase === "uploading";
  const showBack = isIdle && !error;

  const uploadedChunks = chunks.filter((c) => c.uploaded).length;
  const totalChunks = chunks.length;

  return (
    <Animated.View
      style={[
        styles.root,
        {
          backgroundColor: colors.bg,
          opacity: fadeIn,
        },
      ]}
    >
      {/* ── Top: Back button + title ─────────────────────────────────── */}
      {showBack ? (
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={styles.backButton}
        >
          <Text style={[styles.backLabel, { color: colors.textMuted }]}>
            {"<"} Nazad
          </Text>
        </Pressable>
      ) : (
        <View style={styles.backPlaceholder} />
      )}

      <Text style={[styles.meetingTitle, { color: colors.text }]}>
        {meeting.title}
      </Text>

      {/* ── Spacer to push timer to center ───────────────────────────── */}
      <View style={styles.centerSpacer} />

      {/* ── Timer circle ─────────────────────────────────────────────── */}
      <TimerCircle seconds={seconds} phase={phase} />

      {/* ── Phase indicator ──────────────────────────────────────────── */}
      <View style={styles.phaseRow}>
        {isRecording ? (
          <Animated.View
            style={[
              styles.pulseDot,
              {
                backgroundColor: getPhaseColor(),
                opacity: pulseDotAnim,
              },
            ]}
          />
        ) : (
          <View
            style={[
              styles.statusDot,
              { backgroundColor: getPhaseColor() },
            ]}
          />
        )}
        <Text style={[styles.phaseLabel, { color: getPhaseColor() }]}>
          {getPhaseLabel()}
        </Text>
      </View>

      {/* ── Chunk counter ────────────────────────────────────────────── */}
      {(isRecording || isPaused || isUploading) ? (
        <Text style={[styles.chunkLabel, { color: colors.textMuted }]}>
          Segment {currentChunkIndexRef.current}
        </Text>
      ) : null}

      {isPaused && totalChunks > 0 ? (
        <Text style={[styles.chunkSummary, { color: colors.textDim }]}>
          {totalChunks} {totalChunks === 1 ? "segment snimljen" : "segmenata snimljeno"}
        </Text>
      ) : null}

      {/* ── Upload status during pause ───────────────────────────────── */}
      {isPaused && uploadingChunkIndex !== null ? (
        <View style={styles.uploadStatusRow}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={[styles.uploadStatusText, { color: colors.accent }]}>
            Otpremanje segmenta {uploadingChunkIndex}...
          </Text>
        </View>
      ) : null}

      {isPaused && uploadingChunkIndex === null && totalChunks > 0 ? (
        <Text style={[styles.uploadDoneText, { color: colors.success }]}>
          {uploadedChunks}/{totalChunks} otpremljeno
        </Text>
      ) : null}

      {/* ── Error message ────────────────────────────────────────────── */}
      {error ? (
        <View
          style={[
            styles.errorBox,
            { backgroundColor: colors.errorBg },
          ]}
        >
          <Text style={[styles.errorText, { color: colors.error }]}>
            {error}
          </Text>
        </View>
      ) : null}

      {/* ── Spacer to push buttons to bottom ─────────────────────────── */}
      <View style={styles.bottomSpacer} />

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <View style={styles.actions}>
        {/* Idle: Start button */}
        {isIdle ? (
          <PrimaryButton
            label="Zapocni snimanje"
            onPress={() => void handleStart()}
            variant="brand"
            style={styles.actionButtonLarge}
          />
        ) : null}

        {/* Recording: Pause + Stop */}
        {isRecording ? (
          <View style={styles.buttonRow}>
            <Pressable
              onPress={() => void handlePause()}
              style={({ pressed }) => [
                styles.pauseButton,
                { backgroundColor: colors.warning },
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              ]}
            >
              <Text style={styles.pauseIcon}>| |</Text>
              <Text style={styles.pauseLabel}>Pauziraj</Text>
            </Pressable>

            <Pressable
              onPress={() => void handleStop()}
              style={({ pressed }) => [
                styles.stopButton,
                { backgroundColor: colors.recording },
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              ]}
            >
              <View style={styles.stopIcon} />
              <Text style={styles.stopLabel}>Zavrsi</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Paused: Resume + Stop */}
        {isPaused ? (
          <View style={styles.buttonRow}>
            <PrimaryButton
              label="Nastavi"
              onPress={() => void handleResume()}
              variant="brand"
              style={styles.actionButtonHalf}
            />

            <Pressable
              onPress={() => void handleStop()}
              style={({ pressed }) => [
                styles.stopButton,
                { backgroundColor: colors.recording },
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              ]}
            >
              <View style={styles.stopIcon} />
              <Text style={styles.stopLabel}>Zavrsi</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Uploading: spinner */}
        {isUploading ? (
          <View style={styles.uploadingContainer}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={[styles.uploadingText, { color: colors.accent }]}>
              Otpremanje segmenta {uploadingChunkIndex ?? ""}...
            </Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingBottom: 40,
    alignItems: "center",
  },
  backButton: {
    alignSelf: "flex-start",
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  backPlaceholder: {
    height: 35,
    marginBottom: 12,
  },
  meetingTitle: {
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 4,
  },
  centerSpacer: {
    flex: 1,
  },

  // Timer circle
  timerContainer: {
    width: 200,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  timerOuterRing: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 3,
  },
  timerInnerCircle: {
    width: 170,
    height: 170,
    borderRadius: 85,
    alignItems: "center",
    justifyContent: "center",
  },
  timer: {
    fontSize: 44,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    letterSpacing: 3,
    textAlign: "center",
  },
  uploadInsideCircle: {
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  uploadProgressText: {
    fontSize: 12,
    fontWeight: "600",
  },

  // Phase
  phaseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  phaseLabel: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.5,
  },

  // Chunk info
  chunkLabel: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  chunkSummary: {
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 4,
  },

  // Upload status
  uploadStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  uploadStatusText: {
    fontSize: 13,
    fontWeight: "600",
  },
  uploadDoneText: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
    marginBottom: 4,
  },

  // Error
  errorBox: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 8,
    maxWidth: "90%",
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },

  bottomSpacer: {
    flex: 1,
  },

  // Actions
  actions: {
    width: "100%",
    alignItems: "center",
    paddingBottom: 8,
  },
  actionButtonLarge: {
    minWidth: 260,
    paddingVertical: 18,
    borderRadius: 20,
  },
  actionButtonHalf: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 20,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
    justifyContent: "center",
  },
  pauseButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 20,
  },
  pauseIcon: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 2,
  },
  pauseLabel: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  stopButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 20,
  },
  stopIcon: {
    width: 14,
    height: 14,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
  },
  stopLabel: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  uploadingContainer: {
    alignItems: "center",
    gap: 12,
  },
  uploadingText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
