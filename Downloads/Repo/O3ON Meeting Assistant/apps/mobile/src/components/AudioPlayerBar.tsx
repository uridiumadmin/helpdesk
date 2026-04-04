import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { appConfig } from "../config";
import type { AudioFile } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AudioPlayerRef = {
  seekTo: (globalMs: number) => void;
  play: () => void;
  pause: () => void;
};

export type AudioPlayerBarProps = {
  audioFiles: AudioFile[];
  token: string;
  meetingId: string;
  onTimeUpdate: (timeMs: number) => void;
  activeFileUploadId?: string | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAYBACK_RATES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const SKIP_MS = 15000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Reliably fetch the duration of a blob URL.
 *
 * VBR MP3 (and some AAC) files report `Infinity` on `onloadedmetadata`
 * because the browser can't derive duration from the header alone.
 * Seeking to an absurdly large time forces the browser to scan the whole
 * blob and fires `ondurationchange` with the real finite value.
 */
function getAudioDuration(blobUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new window.Audio(blobUrl);
    audio.preload = "metadata";

    function cleanup() {
      audio.onloadedmetadata = null;
      audio.ondurationchange = null;
      audio.onerror = null;
    }

    audio.onerror = () => {
      cleanup();
      resolve(0);
    };

    audio.ondurationchange = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        cleanup();
        resolve(audio.duration * 1000);
      }
    };

    audio.onloadedmetadata = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        cleanup();
        resolve(audio.duration * 1000);
      } else {
        // VBR / no-header: seek to end to force full scan
        audio.currentTime = 1e101;
        // ondurationchange will fire with the real value
      }
    };
  });
}

// ---------------------------------------------------------------------------
// AudioPlayerBar
// ---------------------------------------------------------------------------

export const AudioPlayerBar = forwardRef<AudioPlayerRef, AudioPlayerBarProps>(
  function AudioPlayerBar(
    { audioFiles, token, meetingId, onTimeUpdate, activeFileUploadId },
    ref,
  ) {
    const { colors } = useTheme();

    // ---- Audio state ----
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTimeMs, setCurrentTimeMs] = useState(0);
    const [totalDurationMs, setTotalDurationMs] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [currentFileIndex, setCurrentFileIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    // ---- Refs ----
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const blobUrlCache = useRef<Record<string, string>>({});
    const fileDurations = useRef<Record<string, number>>({});
    const fileOffsets = useRef<number[]>([]);
    const seekBarRef = useRef<View | null>(null);
    const seekBarWidth = useRef(0);
    const isDragging = useRef(false);
    const playbackRateRef = useRef(playbackRate);
    const currentFileIndexRef = useRef(currentFileIndex);
    const isPlayingRef = useRef(isPlaying);

    // Keep refs in sync
    useEffect(() => { playbackRateRef.current = playbackRate; }, [playbackRate]);
    useEffect(() => { currentFileIndexRef.current = currentFileIndex; }, [currentFileIndex]);
    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

    // ---- Compute offsets whenever file durations change ----
    const recomputeOffsets = useCallback(() => {
      const offsets: number[] = [];
      let cumulative = 0;
      let totalMs = 0;
      for (let i = 0; i < audioFiles.length; i++) {
        offsets.push(cumulative);
        const dur = fileDurations.current[audioFiles[i].uploadId] ?? 0;
        cumulative += dur;
        totalMs += dur;
      }
      fileOffsets.current = offsets;
      setTotalDurationMs(totalMs);
    }, [audioFiles]);

    // ---- Set initial file index from activeFileUploadId ----
    useEffect(() => {
      if (activeFileUploadId) {
        const idx = audioFiles.findIndex(
          (f) => f.uploadId === activeFileUploadId,
        );
        if (idx >= 0) setCurrentFileIndex(idx);
      }
    }, [activeFileUploadId, audioFiles]);

    // ---- Blob fetching ----
    const fetchBlobUrl = useCallback(
      async (file: AudioFile): Promise<string | null> => {
        if (blobUrlCache.current[file.uploadId]) {
          return blobUrlCache.current[file.uploadId];
        }
        try {
          const response = await fetch(
            `${appConfig.apiBaseUrl}/v1/meetings/${meetingId}/audio/${file.uploadId}/download`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!response.ok) throw new Error("Download failed");
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          blobUrlCache.current[file.uploadId] = url;
          return url;
        } catch {
          return null;
        }
      },
      [meetingId, token],
    );

    // ---- Load a file into the audio element ----
    const loadFile = useCallback(
      async (index: number, startPlaying: boolean, seekToSec?: number) => {
        if (typeof window === "undefined") return;
        if (index < 0 || index >= audioFiles.length) return;

        setIsLoading(true);
        const file = audioFiles[index];
        const blobUrl = await fetchBlobUrl(file);
        if (!blobUrl) {
          setIsLoading(false);
          return;
        }

        // Ensure duration is known before attaching to the player
        if (!fileDurations.current[file.uploadId]) {
          const durMs = await getAudioDuration(blobUrl);
          if (durMs > 0) {
            fileDurations.current[file.uploadId] = durMs;
            recomputeOffsets();
          }
        }

        // Clean up previous audio element's event handlers
        if (audioRef.current) {
          audioRef.current.onended = null;
          audioRef.current.ontimeupdate = null;
          audioRef.current.ondurationchange = null;
          audioRef.current.pause();
        }

        const audio = new window.Audio(blobUrl);
        audioRef.current = audio;

        // Catch late duration updates (e.g. browser refines estimate mid-play)
        audio.ondurationchange = () => {
          if (isFinite(audio.duration) && audio.duration > 0) {
            fileDurations.current[file.uploadId] = audio.duration * 1000;
            recomputeOffsets();
          }
        };

        audio.ontimeupdate = () => {
          if (isDragging.current) return;
          const offset = fileOffsets.current[currentFileIndexRef.current] ?? 0;
          const globalMs = offset + audio.currentTime * 1000;
          setCurrentTimeMs(globalMs);
          onTimeUpdate(globalMs);
        };

        audio.onended = () => {
          const nextIndex = currentFileIndexRef.current + 1;
          if (nextIndex < audioFiles.length) {
            setCurrentFileIndex(nextIndex);
            void loadFile(nextIndex, true);
          } else {
            // Finished all files
            setIsPlaying(false);
            const totalEnd = fileOffsets.current.reduce((sum, _, i) => {
              return sum + (fileDurations.current[audioFiles[i]?.uploadId] ?? 0);
            }, 0);
            setCurrentTimeMs(totalEnd);
            onTimeUpdate(totalEnd);
          }
        };

        if (seekToSec !== undefined) audio.currentTime = seekToSec;
        audio.playbackRate = playbackRateRef.current;
        setIsLoading(false);

        if (startPlaying) {
          audio.play().catch(() => setIsPlaying(false));
        }
      },
      [audioFiles, fetchBlobUrl, recomputeOffsets, onTimeUpdate],
    );

    // ---- Load first file on mount ----
    useEffect(() => {
      if (audioFiles.length === 0) return;
      void loadFile(currentFileIndex, false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioFiles.length]);

    // ---- Preload all file durations ----
    useEffect(() => {
      if (typeof window === "undefined") return;
      audioFiles.forEach(async (file) => {
        if (fileDurations.current[file.uploadId]) return;
        const blobUrl = await fetchBlobUrl(file);
        if (!blobUrl) return;
        const durMs = await getAudioDuration(blobUrl);
        if (durMs > 0) {
          fileDurations.current[file.uploadId] = durMs;
          recomputeOffsets();
        }
      });
    }, [audioFiles, fetchBlobUrl, recomputeOffsets]);

    // ---- Cleanup on unmount ----
    useEffect(() => {
      return () => {
        if (audioRef.current) {
          audioRef.current.onended = null;
          audioRef.current.ontimeupdate = null;
          audioRef.current.onloadedmetadata = null;
          audioRef.current.pause();
          audioRef.current = null;
        }
        for (const url of Object.values(blobUrlCache.current)) {
          try {
            URL.revokeObjectURL(url);
          } catch {}
        }
      };
    }, []);

    // ---- Resolve global ms to file index + local seconds ----
    const resolveGlobalMs = useCallback(
      (globalMs: number): { fileIndex: number; localSec: number } => {
        const offsets = fileOffsets.current;
        for (let i = audioFiles.length - 1; i >= 0; i--) {
          if (globalMs >= (offsets[i] ?? 0)) {
            return {
              fileIndex: i,
              localSec: (globalMs - (offsets[i] ?? 0)) / 1000,
            };
          }
        }
        return { fileIndex: 0, localSec: 0 };
      },
      [audioFiles.length],
    );

    // ---- Imperative handle ----
    useImperativeHandle(
      ref,
      () => ({
        seekTo(globalMs: number) {
          const { fileIndex, localSec } = resolveGlobalMs(globalMs);
          if (fileIndex === currentFileIndexRef.current && audioRef.current) {
            audioRef.current.currentTime = localSec;
            const offset = fileOffsets.current[fileIndex] ?? 0;
            setCurrentTimeMs(offset + localSec * 1000);
            onTimeUpdate(offset + localSec * 1000);
            if (!isPlayingRef.current) {
              setIsPlaying(true);
              audioRef.current.play().catch(() => setIsPlaying(false));
            }
          } else {
            setCurrentFileIndex(fileIndex);
            setIsPlaying(true);
            void loadFile(fileIndex, true, localSec);
          }
        },
        play() {
          if (audioRef.current && !isPlayingRef.current) {
            setIsPlaying(true);
            audioRef.current.play().catch(() => setIsPlaying(false));
          }
        },
        pause() {
          if (audioRef.current && isPlayingRef.current) {
            audioRef.current.pause();
            setIsPlaying(false);
          }
        },
      }),
      [resolveGlobalMs, loadFile, onTimeUpdate],
    );

    // ---- Controls ----
    const handlePlayPause = useCallback(() => {
      if (!audioRef.current) {
        // No file loaded yet, load and play
        if (audioFiles.length > 0) {
          setIsPlaying(true);
          void loadFile(currentFileIndexRef.current, true);
        }
        return;
      }
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        setIsPlaying(true);
        audioRef.current.play().catch(() => setIsPlaying(false));
      }
    }, [isPlaying, audioFiles.length, loadFile]);

    const handleSkipBack = useCallback(() => {
      const newGlobalMs = Math.max(0, currentTimeMs - SKIP_MS);
      const { fileIndex, localSec } = resolveGlobalMs(newGlobalMs);
      if (fileIndex === currentFileIndexRef.current && audioRef.current) {
        audioRef.current.currentTime = localSec;
        const offset = fileOffsets.current[fileIndex] ?? 0;
        setCurrentTimeMs(offset + localSec * 1000);
        onTimeUpdate(offset + localSec * 1000);
      } else {
        setCurrentFileIndex(fileIndex);
        void loadFile(fileIndex, isPlayingRef.current, localSec);
      }
    }, [currentTimeMs, resolveGlobalMs, loadFile, onTimeUpdate]);

    const handleSkipForward = useCallback(() => {
      const newGlobalMs = Math.min(totalDurationMs, currentTimeMs + SKIP_MS);
      const { fileIndex, localSec } = resolveGlobalMs(newGlobalMs);
      if (fileIndex === currentFileIndexRef.current && audioRef.current) {
        audioRef.current.currentTime = localSec;
        const offset = fileOffsets.current[fileIndex] ?? 0;
        setCurrentTimeMs(offset + localSec * 1000);
        onTimeUpdate(offset + localSec * 1000);
      } else {
        setCurrentFileIndex(fileIndex);
        void loadFile(fileIndex, isPlayingRef.current, localSec);
      }
    }, [currentTimeMs, totalDurationMs, resolveGlobalMs, loadFile, onTimeUpdate]);

    const handlePlaybackRateCycle = useCallback(() => {
      const idx = PLAYBACK_RATES.indexOf(playbackRate);
      const nextRate = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
      setPlaybackRate(nextRate);
      if (audioRef.current) {
        audioRef.current.playbackRate = nextRate;
      }
    }, [playbackRate]);

    // ---- Seek bar interaction (web pointer events) ----
    const seekFromPointerX = useCallback(
      (pageX: number) => {
        if (typeof window === "undefined" || !seekBarRef.current) return;
        // Use the stored layout info
        const node = seekBarRef.current as unknown as HTMLElement;
        const rect = node.getBoundingClientRect?.();
        if (!rect) return;
        const x = Math.max(0, Math.min(pageX - rect.left, rect.width));
        const fraction = rect.width > 0 ? x / rect.width : 0;
        const newGlobalMs = fraction * totalDurationMs;

        setCurrentTimeMs(newGlobalMs);
        onTimeUpdate(newGlobalMs);

        const { fileIndex, localSec } = resolveGlobalMs(newGlobalMs);
        if (fileIndex === currentFileIndexRef.current && audioRef.current) {
          audioRef.current.currentTime = localSec;
        } else {
          setCurrentFileIndex(fileIndex);
          void loadFile(fileIndex, isPlayingRef.current, localSec);
        }
      },
      [totalDurationMs, resolveGlobalMs, loadFile, onTimeUpdate],
    );

    const handleSeekBarPointerDown = useCallback(
      (e: { nativeEvent: { pageX: number } }) => {
        isDragging.current = true;
        seekFromPointerX(e.nativeEvent.pageX);
      },
      [seekFromPointerX],
    );

    const handleSeekBarPointerMove = useCallback(
      (e: { nativeEvent: { pageX: number } }) => {
        if (!isDragging.current) return;
        seekFromPointerX(e.nativeEvent.pageX);
      },
      [seekFromPointerX],
    );

    const handleSeekBarPointerUp = useCallback(() => {
      isDragging.current = false;
    }, []);

    // Global pointer-up listener for drag release outside bar
    useEffect(() => {
      if (typeof window === "undefined") return;
      const handler = () => {
        isDragging.current = false;
      };
      window.addEventListener("pointerup", handler);
      return () => window.removeEventListener("pointerup", handler);
    }, []);

    // ---- Layout handler for seek bar ----
    const handleSeekBarLayout = useCallback(
      (e: { nativeEvent: { layout: { width: number } } }) => {
        seekBarWidth.current = e.nativeEvent.layout.width;
      },
      [],
    );

    // ---- Compute seek bar fill fraction ----
    const fraction =
      totalDurationMs > 0 ? Math.min(1, currentTimeMs / totalDurationMs) : 0;

    // ---- Don't render if no audio files ----
    if (audioFiles.length === 0) return null;

    return (
      <View
        style={[
          playerStyles.container,
          {
            backgroundColor: colors.bgCard,
            borderTopColor: colors.border,
          },
        ]}
      >
        {/* ---- Controls row ---- */}
        <View style={playerStyles.controlsRow}>
          {/* Skip back */}
          <Pressable
            onPress={handleSkipBack}
            style={playerStyles.skipBtn}
            accessibilityLabel="Premotaj 15s unazad"
          >
            <Text style={[playerStyles.skipText, { color: colors.accent }]}>
              {"\u23EA 15"}
            </Text>
          </Pressable>

          {/* Play/Pause */}
          <Pressable
            onPress={handlePlayPause}
            style={[
              playerStyles.playBtn,
              { backgroundColor: colors.accent },
            ]}
            accessibilityLabel={isPlaying ? "Pauziraj" : "Pusti"}
          >
            <Text style={playerStyles.playBtnText}>
              {isLoading ? "..." : isPlaying ? "\u275A\u275A" : "\u25B6"}
            </Text>
          </Pressable>

          {/* Skip forward */}
          <Pressable
            onPress={handleSkipForward}
            style={playerStyles.skipBtn}
            accessibilityLabel="Premotaj 15s unapred"
          >
            <Text style={[playerStyles.skipText, { color: colors.accent }]}>
              {"15 \u23E9"}
            </Text>
          </Pressable>

          {/* Time display */}
          <Text style={[playerStyles.timeText, { color: colors.textDim }]}>
            {formatTimeMmSs(currentTimeMs)} / {formatTimeMmSs(totalDurationMs)}
          </Text>

          {/* Playback rate */}
          <Pressable
            onPress={handlePlaybackRateCycle}
            style={[
              playerStyles.rateBtn,
              { backgroundColor: colors.accentBg },
            ]}
            accessibilityLabel={`Brzina ${playbackRate}x`}
          >
            <Text style={[playerStyles.rateText, { color: colors.textDim }]}>
              {playbackRate}x
            </Text>
          </Pressable>
        </View>

        {/* ---- Seek bar ---- */}
        <Pressable
          ref={seekBarRef as React.RefObject<View>}
          onLayout={handleSeekBarLayout}
          onPointerDown={handleSeekBarPointerDown as any}
          onPointerMove={handleSeekBarPointerMove as any}
          onPointerUp={handleSeekBarPointerUp as any}
          style={[
            playerStyles.seekBarTrack,
            { backgroundColor: colors.separator },
          ]}
          accessibilityLabel="Seek bar"
        >
          {/* Filled portion */}
          <View
            style={[
              playerStyles.seekBarFill,
              {
                backgroundColor: colors.accent,
                width: `${(fraction * 100).toFixed(2)}%` as unknown as number,
              },
            ]}
          />
          {/* Thumb */}
          <View
            style={[
              playerStyles.seekBarThumb,
              {
                backgroundColor: colors.accent,
                left: `${(fraction * 100).toFixed(2)}%` as unknown as number,
              },
            ]}
          />
        </Pressable>
      </View>
    );
  },
);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const playerStyles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  skipBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(128,128,128,0.1)",
    borderRadius: 12,
  },
  skipText: {
    fontSize: 14,
    fontWeight: "700",
  },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  playBtnText: {
    color: "#0A0F1E",
    fontSize: 18,
    fontWeight: "800",
  },
  timeText: {
    fontSize: 14,
    fontWeight: "500",
    marginLeft: "auto",
  },
  rateBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(128,128,128,0.2)",
  },
  rateText: {
    fontSize: 13,
    fontWeight: "700",
  },
  seekBarTrack: {
    height: 8,
    borderRadius: 4,
    position: "relative",
    justifyContent: "center",
    cursor: "pointer" as any,
  },
  seekBarFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 4,
  },
  seekBarThumb: {
    position: "absolute",
    width: 16,
    height: 16,
    borderRadius: 8,
    top: -4,
    marginLeft: -8,
  },
});
