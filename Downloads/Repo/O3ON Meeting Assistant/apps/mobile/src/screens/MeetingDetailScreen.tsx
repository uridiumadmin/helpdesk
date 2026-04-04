import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PrimaryButton } from "../components/PrimaryButton";
import { AudioPlayerBar, AudioPlayerRef } from "../components/AudioPlayerBar";
import { useTheme } from "../theme/ThemeContext";
import { useProcessingStatus } from "../hooks/useProcessingStatus";
import { api } from "../lib/api";
import type { AudioFile, Meeting, MeetingArtifact, MeetingShare, SpeakerMapping } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPEAKER_COLORS = [
  "#1565C0",
  "#7B1FA2",
  "#C62828",
  "#00838F",
  "#2E7D32",
  "#EF6C00",
];

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function speakerColor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = label.charCodeAt(i) + ((h << 5) - h);
  return SPEAKER_COLORS[Math.abs(h) % SPEAKER_COLORS.length];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const months = [
    "januar",
    "februar",
    "mart",
    "april",
    "maj",
    "jun",
    "jul",
    "avgust",
    "septembar",
    "oktobar",
    "novembar",
    "decembar",
  ];
  return `${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}.`;
}

function confidenceColor(value: number, success: string, warning: string, error: string): string {
  if (value >= 0.8) return success;
  if (value >= 0.5) return warning;
  return error;
}

// ---------------------------------------------------------------------------
// Section divider
// ---------------------------------------------------------------------------

function SectionDivider() {
  const { colors } = useTheme();
  return <View style={[styles.sectionDivider, { backgroundColor: colors.separator }]} />;
}

// ---------------------------------------------------------------------------
// Processing spinner animation
// ---------------------------------------------------------------------------

function ProcessingSpinner() {
  const { colors } = useTheme();
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [spinAnim, pulseAnim]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View
      style={[
        styles.processingSpinnerOuter,
        {
          opacity: pulseAnim,
          transform: [{ rotate: spin }],
          borderColor: colors.brand,
          borderTopColor: "transparent",
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// MeetingDetailScreen
// ---------------------------------------------------------------------------

export function MeetingDetailScreen({ meeting, token, onBack, currentUserId }: {
  meeting: Meeting;
  token: string;
  onBack: () => void;
  currentUserId: string;
}) {
  const { colors, isDark } = useTheme();
  const {
    data: statusData,
    isProcessing,
    isReady,
    isFailed,
    error: statusError,
  } = useProcessingStatus(token, meeting.id, true);

  const [artifact, setArtifact] = useState<MeetingArtifact | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Partial transcript for progressive display
  const [partialSegments, setPartialSegments] = useState<
    Array<{ speaker: string; text: string; start: number; end: number; confidence: number }>
  >([]);
  const lastChunksCompleted = useRef(0);

  // Sharing state
  const isOwner = meeting.createdById === currentUserId;
  const [shares, setShares] = useState<MeetingShare[]>([]);
  const [shareEmail, setShareEmail] = useState("");
  const [sharingBusy, setSharingBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  // Audio state
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);

  // Speaker mapping state
  const [speakerMappings, setSpeakerMappings] = useState<Record<string, string>>({});
  const [speakerInputs, setSpeakerInputs] = useState<Record<string, string>>({});
  const [speakerSaving, setSpeakerSaving] = useState(false);
  const [speakerSaveSuccess, setSpeakerSaveSuccess] = useState(false);

  // Fade-in animation
  const fadeIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [fadeIn]);

  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;

    async function fetchArtifacts() {
      try {
        const result = await api.getArtifacts(token, meeting.id);
        if (!cancelled) setArtifact(result);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error
              ? err.message
              : "Neuspešno učitavanje rezultata",
          );
        }
      }
    }

    void fetchArtifacts();
    return () => {
      cancelled = true;
    };
  }, [isReady, token, meeting.id]);

  // Fetch partial transcript when chunks complete during processing_chunks
  useEffect(() => {
    const completed = statusData?.chunksCompleted ?? 0;
    if (
      statusData?.status === "processing_chunks" &&
      completed > 0 &&
      completed !== lastChunksCompleted.current
    ) {
      lastChunksCompleted.current = completed;
      api.getPartialTranscript(token, meeting.id).then((result) => {
        setPartialSegments(result.segments);
      }).catch(() => {
        // silently fail
      });
    }
  }, [statusData?.chunksCompleted, statusData?.status, token, meeting.id]);

  // Fetch shares (only for owner)
  const fetchShares = useCallback(async () => {
    if (!isOwner) return;
    try {
      const data = await api.listShares(token, meeting.id);
      setShares(data);
    } catch {
      // silently fail
    }
  }, [isOwner, token, meeting.id]);

  useEffect(() => {
    void fetchShares();
  }, [fetchShares]);

  // Fetch audio files
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const files = await api.getAudioFiles(token, meeting.id);
        if (!cancelled) setAudioFiles(files);
      } catch {
        // silently fail
      }
    })();
    return () => { cancelled = true; };
  }, [token, meeting.id]);

  // Fetch speaker mappings
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mappings = await api.getSpeakerMappings(token, meeting.id);
        if (!cancelled) {
          const map: Record<string, string> = {};
          for (const m of mappings) {
            map[m.speakerLabel] = m.displayName;
          }
          setSpeakerMappings(map);
          setSpeakerInputs(map);
        }
      } catch {
        // silently fail
      }
    })();
    return () => { cancelled = true; };
  }, [token, meeting.id]);

  // Save speaker mappings handler
  async function handleSaveSpeakers() {
    setSpeakerSaving(true);
    setSpeakerSaveSuccess(false);
    try {
      const mappingsToSave: SpeakerMapping[] = Object.entries(speakerInputs)
        .filter(([, name]) => name.trim().length > 0)
        .map(([label, name]) => ({ speakerLabel: label, displayName: name.trim() }));
      await api.updateSpeakerMappings(token, meeting.id, mappingsToSave);
      const map: Record<string, string> = {};
      for (const m of mappingsToSave) {
        map[m.speakerLabel] = m.displayName;
      }
      setSpeakerMappings(map);
      setSpeakerSaveSuccess(true);
      setTimeout(() => setSpeakerSaveSuccess(false), 2000);
    } catch {
      // silently fail
    } finally {
      setSpeakerSaving(false);
    }
  }

  // Sharing handlers
  async function handleShareAdd() {
    const email = shareEmail.trim();
    if (!email) return;
    setSharingBusy(true);
    setShareError(null);
    try {
      const share = await api.shareMeeting(token, meeting.id, email);
      setShares((prev) => [...prev, share]);
      setShareEmail("");
    } catch (err) {
      setShareError(
        err instanceof Error ? err.message : "Greška pri deljenju",
      );
    } finally {
      setSharingBusy(false);
    }
  }

  async function handleShareRevoke(shareId: string) {
    try {
      await api.revokeShare(token, meeting.id, shareId);
      setShares((prev) => prev.filter((s) => s.id !== shareId));
    } catch {
      // silently fail
    }
  }

  // Export state
  const [exportBusy, setExportBusy] = useState(false);
  const [exportToast, setExportToast] = useState(false);

  // Audio player ref
  const playerRef = useRef<AudioPlayerRef>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(-1);

  // Auto-scroll state
  const scrollViewRef = useRef<ScrollView>(null);
  const segmentYPositions = useRef<Record<string, number>>({});
  const lastAutoScrollSegId = useRef<string | null>(null);
  const userScrolledAt = useRef<number>(0);
  const AUTO_SCROLL_COOLDOWN = 5000;

  const handlePlayerTimeUpdate = useCallback((timeMs: number) => {
    setCurrentTimeMs(timeMs);
  }, []);

  function handleTranscriptSeek(startMs: number) {
    playerRef.current?.seekTo(startMs);
  }

  // Auto-scroll to active transcript segment
  useEffect(() => {
    if (!artifact || currentTimeMs < 0) return;
    const now = Date.now();
    if (now - userScrolledAt.current < AUTO_SCROLL_COOLDOWN) return;

    const activeSeg = artifact.transcript.find(
      (seg) => currentTimeMs >= seg.startMs && currentTimeMs < seg.endMs,
    );
    if (!activeSeg) return;
    if (activeSeg.id === lastAutoScrollSegId.current) return;

    lastAutoScrollSegId.current = activeSeg.id;
    const y = segmentYPositions.current[activeSeg.id];
    if (y !== undefined && scrollViewRef.current) {
      scrollViewRef.current.scrollTo({ y: Math.max(0, y - 100), animated: true });
    }
  }, [currentTimeMs, artifact]);

  const handleScrollBeginDrag = useCallback(() => {
    userScrolledAt.current = Date.now();
  }, []);

  // Export handler
  async function handleExport() {
    setExportBusy(true);
    try {
      const md = await api.exportMeeting(token, meeting.id);
      // Try Web Share API first, then fall back to clipboard
      if (typeof navigator !== "undefined" && navigator.share) {
        try {
          await navigator.share({
            title: meeting.title,
            text: md,
          });
          setExportBusy(false);
          return;
        } catch {
          // share cancelled or unsupported — fall back to clipboard
        }
      }
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(md);
      }
      setExportToast(true);
      setTimeout(() => setExportToast(false), 2000);
    } catch {
      // silently fail
    } finally {
      setExportBusy(false);
    }
  }

  // --------------------------------------------------
  // Derived data
  // --------------------------------------------------

  const participantNames = meeting.participants.map((p) => p.name);
  const needsReview = artifact?.needsReview === true;

  // --------------------------------------------------
  // Back button component
  // --------------------------------------------------

  function BackButton() {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={styles.backBtn}
      >
        <Text style={[styles.backArrow, { color: colors.textMuted }]}>
          {"<"}
        </Text>
        <Text style={[styles.backLabel, { color: colors.textMuted }]}>
          Sastanci
        </Text>
      </Pressable>
    );
  }

  // --------------------------------------------------
  // Processing state
  // --------------------------------------------------

  if (isProcessing) {
    const chunksTotal = statusData?.chunksTotal ?? 0;
    const chunksCompleted = statusData?.chunksCompleted ?? 0;
    const isChunking = statusData?.status === "processing_chunks";
    const isSummarizing = statusData?.status === "summarizing";
    const progressRatio = chunksTotal > 0 ? chunksCompleted / chunksTotal : 0;

    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <Animated.View
          style={[styles.processingContainer, { opacity: fadeIn }]}
        >
          <BackButton />

          <View style={styles.processingContent}>
            <ProcessingSpinner />
            <View style={styles.processingSpacing} />
            <Text
              style={[styles.processingTitle, { color: colors.brand }]}
            >
              {isSummarizing ? "Generisanje rezimea..." : "Obrada u toku..."}
            </Text>
            {isChunking && chunksTotal > 0 ? (
              <>
                <Text
                  style={[
                    styles.processingSubtitle,
                    { color: colors.textDim },
                  ]}
                >
                  Transkripcija: {chunksCompleted}/{chunksTotal} delova
                </Text>
                <View style={[styles.progressBarBg, { backgroundColor: colors.separator }]}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        backgroundColor: colors.brand,
                        width: `${Math.round(progressRatio * 100)}%`,
                      },
                    ]}
                  />
                </View>
              </>
            ) : (
              <Text
                style={[
                  styles.processingSubtitle,
                  { color: colors.textDim },
                ]}
              >
                {isSummarizing
                  ? "Analiziranje kompletnog transkripta"
                  : "Transkripcija i analiza vašeg snimka"}
              </Text>
            )}
            <Text
              style={[
                styles.processingMeetingTitle,
                { color: colors.textMuted },
              ]}
            >
              {meeting.title}
            </Text>

            {/* Partial transcript preview */}
            {partialSegments.length > 0 ? (
              <View style={styles.partialTranscriptContainer}>
                <Text style={[styles.partialTranscriptTitle, { color: colors.textDim }]}>
                  Transkript u toku ({partialSegments.length} segmenata)
                </Text>
                <ScrollView style={styles.partialTranscriptScroll} nestedScrollEnabled>
                  {partialSegments.slice(-10).map((seg, i) => (
                    <View key={i} style={styles.partialSegmentRow}>
                      <Text style={[styles.partialSpeaker, { color: speakerColor(seg.speaker) }]}>
                        {seg.speaker}
                      </Text>
                      <Text style={[styles.partialText, { color: colors.textMuted }]}>
                        {seg.text}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </View>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // --------------------------------------------------
  // Failed state
  // --------------------------------------------------

  if (isFailed) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <Animated.View style={{ opacity: fadeIn, flex: 1 }}>
          <ScrollView contentContainerStyle={styles.container}>
            <BackButton />

            <View
              style={[
                styles.errorCard,
                {
                  backgroundColor: colors.errorBg,
                  borderColor: colors.error + "40",
                },
              ]}
            >
              <Text style={[styles.errorTitle, { color: colors.error }]}>
                Obrada neuspešna
              </Text>
              <Text style={[styles.errorBody, { color: colors.error }]}>
                {statusError ?? "Došlo je do greške tokom obrade."}
              </Text>
            </View>

            <PrimaryButton
              label="Nazad"
              onPress={onBack}
              variant="secondary"
            />
          </ScrollView>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // --------------------------------------------------
  // Card wrapper
  // --------------------------------------------------

  function Card({
    children,
    accentBorder,
  }: {
    children: React.ReactNode;
    accentBorder?: string;
  }) {
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.bgCard,
            borderColor: colors.border,
          },
          accentBorder
            ? { borderLeftColor: accentBorder, borderLeftWidth: 3 }
            : null,
          !isDark && {
            shadowColor: colors.shadow,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 1,
            shadowRadius: 8,
            elevation: 2,
          },
        ]}
      >
        {children}
      </View>
    );
  }

  // --------------------------------------------------
  // Results state (or initial loading)
  // --------------------------------------------------

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      <Animated.View style={{ opacity: fadeIn, flex: 1 }}>
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={handleScrollBeginDrag}
        >
          {/* ---- Header section ---- */}
          <View style={styles.headerRow}>
            <BackButton />
            <View style={styles.headerActions}>
              {exportToast ? (
                <View style={[styles.exportToast, { backgroundColor: colors.successBg }]}>
                  <Text style={[styles.exportToastText, { color: colors.success }]}>
                    Kopirano!
                  </Text>
                </View>
              ) : (
                <Pressable
                  onPress={handleExport}
                  disabled={exportBusy}
                  style={[styles.exportBtn, { backgroundColor: colors.brandBg, opacity: exportBusy ? 0.5 : 1 }]}
                >
                  <Text style={[styles.exportBtnText, { color: colors.brand }]}>
                    {exportBusy ? "..." : "Izvezi"}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>

          <Text style={[styles.title, { color: colors.text }]}>
            {meeting.title}
          </Text>

          <View style={styles.metaRow}>
            <Text style={[styles.metaText, { color: colors.textDim }]}>
              {formatDate(meeting.startsAt)}
            </Text>
            <View
              style={[
                styles.metaDot,
                { backgroundColor: colors.textDim },
              ]}
            />
            <Text style={[styles.metaText, { color: colors.textDim }]}>
              {meeting.durationMinutes} min
            </Text>
            {meeting.participants.length > 0 ? (
              <>
                <View
                  style={[
                    styles.metaDot,
                    { backgroundColor: colors.textDim },
                  ]}
                />
                <Text
                  style={[styles.metaText, { color: colors.textDim }]}
                >
                  {meeting.participants.length}{" "}
                  {meeting.participants.length === 1
                    ? "učesnik"
                    : "učesnika"}
                </Text>
              </>
            ) : null}
          </View>

          {/* Participant chips */}
          {participantNames.length > 0 ? (
            <View style={styles.chipRow}>
              {participantNames.map((name, i) => {
                const chipColor = speakerColor(name);
                return (
                  <View
                    key={i}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: chipColor + "18",
                        borderColor: chipColor + "30",
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.chipDot,
                        { backgroundColor: chipColor },
                      ]}
                    />
                    <Text
                      style={[styles.chipText, { color: chipColor }]}
                    >
                      {name}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* ---- Needs review banner ---- */}
          {needsReview ? (
            <View
              style={[
                styles.reviewBanner,
                {
                  backgroundColor: colors.warningBg,
                  borderColor: colors.warning + "40",
                },
              ]}
            >
              <Text
                style={[
                  styles.reviewText,
                  { color: colors.warning },
                ]}
              >
                Rezultati zahtevaju reviziju
              </Text>
            </View>
          ) : null}

          {/* ---- Load error ---- */}
          {loadError ? (
            <View
              style={[
                styles.emptyStateRow,
                {
                  backgroundColor: colors.errorBg,
                  borderColor: colors.error + "30",
                },
              ]}
            >
              <Text style={[styles.emptyStateIcon, { color: colors.error }]}>
                !
              </Text>
              <Text
                style={[
                  styles.errorBody,
                  { color: colors.error, flex: 1 },
                ]}
              >
                {loadError}
              </Text>
              <Pressable
                onPress={() => {
                  setLoadError(null);
                  setArtifact(null);
                  (async () => {
                    try {
                      const result = await api.getArtifacts(token, meeting.id);
                      setArtifact(result);
                    } catch (err) {
                      setLoadError(
                        err instanceof Error
                          ? err.message
                          : "Neuspešno učitavanje rezultata",
                      );
                    }
                  })();
                }}
                style={[
                  styles.retryBtn,
                  { backgroundColor: colors.error + "20" },
                ]}
              >
                <Text
                  style={[styles.retryBtnText, { color: colors.error }]}
                >
                  Pokušaj ponovo
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* ---- Loading indicator while fetching artifacts ---- */}
          {!artifact && isReady && !loadError ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.brand} size="small" />
              <Text
                style={[
                  styles.loadingText,
                  { color: colors.textMuted },
                ]}
              >
                Učitavanje rezultata...
              </Text>
            </View>
          ) : null}

          {/* ---- Artifact sections ---- */}
          {artifact ? (
            <>
              {/* Summary card */}
              <Card accentBorder={colors.brand}>
                <Text
                  style={[
                    styles.sectionTitle,
                    { color: colors.text },
                  ]}
                >
                  Rezime
                </Text>
                <Text
                  style={[
                    styles.sectionBody,
                    { color: colors.textMuted },
                  ]}
                >
                  {artifact.summary}
                </Text>
              </Card>

              <SectionDivider />

              {/* Action Items card */}
              {artifact.actionItems.length > 0 ? (
                <>
                  <Card accentBorder={colors.accent}>
                    <Text
                      style={[
                        styles.sectionTitle,
                        { color: colors.text },
                      ]}
                    >
                      Akcioni koraci
                    </Text>
                    {artifact.actionItems.map((item) => (
                      <View
                        key={item.id}
                        style={[
                          styles.actionRow,
                          {
                            borderBottomColor: colors.separator,
                          },
                        ]}
                      >
                        <View style={styles.actionHeader}>
                          <View
                            style={[
                              styles.checkbox,
                              { borderColor: colors.border },
                            ]}
                          />
                          <Text
                            style={[
                              styles.actionTitle,
                              { color: colors.text },
                            ]}
                          >
                            {item.title}
                          </Text>
                        </View>
                        <View style={styles.actionTagRow}>
                          {item.owner ? (
                            <View
                              style={[
                                styles.actionTag,
                                {
                                  backgroundColor:
                                    colors.brandBg,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.actionTagText,
                                  {
                                    color:
                                      colors.brandLight,
                                  },
                                ]}
                              >
                                {item.owner}
                              </Text>
                            </View>
                          ) : null}
                          {item.dueDate ? (
                            <View
                              style={[
                                styles.actionTag,
                                {
                                  backgroundColor:
                                    colors.warningBg,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.actionTagText,
                                  {
                                    color: colors.warning,
                                  },
                                ]}
                              >
                                {item.dueDate}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <View
                          style={[
                            styles.confidenceBar,
                            {
                              backgroundColor:
                                colors.separator,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.confidenceFill,
                              {
                                width: `${Math.round(item.confidence * 100)}%`,
                                backgroundColor:
                                  confidenceColor(
                                    item.confidence,
                                    colors.success,
                                    colors.warning,
                                    colors.error,
                                  ),
                              },
                            ]}
                          />
                        </View>
                      </View>
                    ))}
                  </Card>
                  <SectionDivider />
                </>
              ) : null}

              {/* Speakers card */}
              {artifact.transcript.length > 0 ? (() => {
                const uniqueLabels = Array.from(
                  new Set(artifact.transcript.map((seg) => seg.speakerLabel))
                );
                return uniqueLabels.length > 0 ? (
                  <>
                    <Card>
                      <Text
                        style={[styles.sectionTitle, { color: colors.text }]}
                      >
                        Sagovornici
                      </Text>
                      {uniqueLabels.map((label) => {
                        const sColor = speakerColor(label);
                        return (
                          <View key={label} style={styles.speakerRow}>
                            <View
                              style={[
                                styles.speakerDot,
                                { backgroundColor: sColor },
                              ]}
                            />
                            <Text
                              style={[
                                styles.speakerLabel,
                                { color: sColor },
                              ]}
                              numberOfLines={1}
                            >
                              {label}
                            </Text>
                            <TextInput
                              style={[
                                styles.speakerInput,
                                {
                                  backgroundColor: colors.bgInput,
                                  borderColor: colors.borderLight,
                                  color: colors.text,
                                },
                              ]}
                              placeholder="Unesite ime"
                              placeholderTextColor={colors.textDim}
                              value={speakerInputs[label] ?? ""}
                              onChangeText={(v) =>
                                setSpeakerInputs((prev) => ({
                                  ...prev,
                                  [label]: v,
                                }))
                              }
                              maxLength={100}
                              autoCapitalize="words"
                              autoCorrect={false}
                            />
                          </View>
                        );
                      })}
                      <View style={styles.speakerBtnRow}>
                        {speakerSaveSuccess ? (
                          <View
                            style={[
                              styles.speakerSuccessToast,
                              { backgroundColor: colors.successBg },
                            ]}
                          >
                            <Text
                              style={[
                                styles.speakerSuccessText,
                                { color: colors.success },
                              ]}
                            >
                              Imena sačuvana!
                            </Text>
                          </View>
                        ) : (
                          <Pressable
                            onPress={handleSaveSpeakers}
                            disabled={speakerSaving}
                            style={[
                              styles.speakerSaveBtn,
                              {
                                backgroundColor: colors.brand,
                                opacity: speakerSaving ? 0.5 : 1,
                              },
                            ]}
                          >
                            <Text style={styles.speakerSaveBtnText}>
                              {speakerSaving ? "..." : "Sacuvaj imena"}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    </Card>
                    <SectionDivider />
                  </>
                ) : null;
              })() : null}

              {/* Transcript card */}
              {artifact.transcript.length > 0 ? (
                <>
                  <Card>
                    <Text
                      style={[
                        styles.sectionTitle,
                        { color: colors.text },
                      ]}
                    >
                      Transkript ({artifact.transcript.length}{" "}
                      {artifact.transcript.length === 1
                        ? "segment"
                        : "segmenata"}
                      )
                    </Text>
                    {artifact.transcript.map((seg) => {
                      const sColor = speakerColor(
                        seg.speakerLabel,
                      );
                      const isActive =
                        currentTimeMs >= 0 &&
                        currentTimeMs >= seg.startMs &&
                        currentTimeMs < seg.endMs;
                      return (
                        <Pressable
                          key={seg.id}
                          onPress={() => handleTranscriptSeek(seg.startMs)}
                          onLayout={(e) => {
                            segmentYPositions.current[seg.id] = e.nativeEvent.layout.y;
                          }}
                          style={[
                            styles.transcriptRow,
                            {
                              borderBottomColor:
                                colors.separator,
                            },
                            isActive
                              ? {
                                  borderLeftWidth: 3,
                                  borderLeftColor: "#D4A017",
                                  backgroundColor: isDark
                                    ? "rgba(212, 160, 23, 0.08)"
                                    : "rgba(212, 160, 23, 0.06)",
                                  paddingLeft: 12,
                                }
                              : null,
                          ]}
                        >
                          <View style={styles.transcriptHeader}>
                            <View
                              style={
                                styles.transcriptSpeaker
                              }
                            >
                              <View
                                style={[
                                  styles.speakerDot,
                                  {
                                    backgroundColor:
                                      sColor,
                                  },
                                ]}
                              />
                              <Text
                                style={[
                                  styles.speakerName,
                                  { color: sColor },
                                ]}
                              >
                                {speakerMappings[seg.speakerLabel] ??
                                  seg.speakerName ??
                                  seg.speakerLabel}
                              </Text>
                              {seg.confidence < 0.5 ? (
                                <View
                                  style={[
                                    styles.lowConfidenceBadge,
                                    {
                                      backgroundColor:
                                        colors.errorBg,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.lowConfidenceText,
                                      {
                                        color:
                                          colors.error,
                                      },
                                    ]}
                                  >
                                    nizak
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                            <Text
                              style={[
                                styles.timeRange,
                                {
                                  color: colors.textDim,
                                },
                              ]}
                            >
                              {formatTime(seg.startMs)} -{" "}
                              {formatTime(seg.endMs)}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.transcriptText,
                              {
                                color: colors.textMuted,
                              },
                            ]}
                          >
                            {seg.text}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </Card>
                  <SectionDivider />
                </>
              ) : (
                <>
                  <View
                    style={[
                      styles.emptyStateRow,
                      {
                        backgroundColor: colors.bgCard,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.emptyStateIcon,
                        { color: colors.textDim },
                      ]}
                    >
                      i
                    </Text>
                    <Text
                      style={[
                        styles.emptyStateText,
                        { color: colors.textDim },
                      ]}
                    >
                      Transkript još nije dostupan.
                    </Text>
                  </View>
                  <SectionDivider />
                </>
              )}

              {/* Decisions card */}
              {artifact.decisions.length > 0 ? (
                <>
                  <Card accentBorder={colors.success}>
                    <Text
                      style={[
                        styles.sectionTitle,
                        { color: colors.text },
                      ]}
                    >
                      Odluke
                    </Text>
                    {artifact.decisions.map((item, i) => (
                      <View key={i} style={styles.decisionRow}>
                        <View
                          style={[
                            styles.decisionNumber,
                            {
                              backgroundColor:
                                colors.successBg,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.decisionNumberText,
                              {
                                color: colors.success,
                              },
                            ]}
                          >
                            {i + 1}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.sectionBody,
                            {
                              color: colors.textMuted,
                              flex: 1,
                            },
                          ]}
                        >
                          {item}
                        </Text>
                      </View>
                    ))}
                  </Card>
                  <SectionDivider />
                </>
              ) : null}

              {/* Minutes card */}
              {artifact.minutes.length > 0 ? (
                <>
                  <Card>
                    <Text
                      style={[
                        styles.sectionTitle,
                        { color: colors.text },
                      ]}
                    >
                      Zapisnik
                    </Text>
                    {artifact.minutes.map((item, i) => (
                      <View key={i} style={styles.minuteRow}>
                        <Text
                          style={[
                            styles.bulletChar,
                            { color: colors.textDim },
                          ]}
                        >
                          {"\u2022"}
                        </Text>
                        <Text
                          style={[
                            styles.sectionBody,
                            {
                              color: colors.textMuted,
                              flex: 1,
                            },
                          ]}
                        >
                          {item}
                        </Text>
                      </View>
                    ))}
                  </Card>
                  <SectionDivider />
                </>
              ) : null}

              {/* Risks card */}
              {artifact.risks && artifact.risks.length > 0 ? (
                <>
                  <Card accentBorder={colors.warning}>
                    <Text
                      style={[
                        styles.sectionTitle,
                        { color: colors.warning },
                      ]}
                    >
                      Rizici
                    </Text>
                    {artifact.risks.map((item, i) => (
                      <View key={i} style={styles.riskRow}>
                        <View
                          style={[
                            styles.riskIconCircle,
                            {
                              backgroundColor:
                                colors.warningBg,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.riskIcon,
                              {
                                color: colors.warning,
                              },
                            ]}
                          >
                            !
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.riskBody,
                            {
                              color: isDark
                                ? "#FCD34D"
                                : colors.warning,
                            },
                          ]}
                        >
                          {item}
                        </Text>
                      </View>
                    ))}
                  </Card>
                  <SectionDivider />
                </>
              ) : null}

              {/* Open Questions card */}
              {artifact.openQuestions &&
              artifact.openQuestions.length > 0 ? (
                <Card accentBorder={colors.brandLight}>
                  <Text
                    style={[
                      styles.sectionTitle,
                      { color: colors.text },
                    ]}
                  >
                    Otvorena pitanja
                  </Text>
                  {artifact.openQuestions.map((item, i) => (
                    <View key={i} style={styles.questionRow}>
                      <View
                        style={[
                          styles.questionMarkCircle,
                          {
                            backgroundColor:
                              colors.brandBg,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.questionMark,
                            {
                              color: colors.brandLight,
                            },
                          ]}
                        >
                          ?
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.sectionBody,
                          {
                            color: colors.textMuted,
                            flex: 1,
                          },
                        ]}
                      >
                        {item}
                      </Text>
                    </View>
                  ))}
                </Card>
              ) : null}
            </>
          ) : null}

          {/* ---- Sharing section (owner only) ---- */}
          {isOwner ? (
            <>
              <SectionDivider />
              <Card>
                <Text
                  style={[styles.sectionTitle, { color: colors.text }]}
                >
                  Podeli sastanak
                </Text>

                {/* Current shares */}
                {shares.length > 0 ? (
                  shares.map((share) => (
                    <View
                      key={share.id}
                      style={[
                        styles.shareRow,
                        { borderBottomColor: colors.separator },
                      ]}
                    >
                      <Text
                        style={[
                          styles.shareEmail,
                          { color: colors.textMuted },
                        ]}
                        numberOfLines={1}
                      >
                        {share.sharedWithEmail}
                      </Text>
                      <Pressable
                        onPress={() => handleShareRevoke(share.id)}
                        style={[
                          styles.revokeBtn,
                          { backgroundColor: colors.errorBg },
                        ]}
                      >
                        <Text
                          style={[
                            styles.revokeBtnText,
                            { color: colors.error },
                          ]}
                        >
                          Opozovi
                        </Text>
                      </Pressable>
                    </View>
                  ))
                ) : (
                  <View
                    style={[
                      styles.emptyStateInline,
                      {
                        backgroundColor: colors.bgCard,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.emptyStateIcon,
                        { color: colors.textDim },
                      ]}
                    >
                      i
                    </Text>
                    <Text
                      style={[
                        styles.emptyStateText,
                        { color: colors.textDim },
                      ]}
                    >
                      Ovaj sastanak nije deljen.
                    </Text>
                  </View>
                )}

                {/* Add new share */}
                <View style={styles.shareAddRow}>
                  <TextInput
                    style={[
                      styles.shareInput,
                      {
                        backgroundColor: colors.bgInput,
                        borderColor: colors.borderLight,
                        color: colors.text,
                      },
                    ]}
                    placeholder="Email adresa"
                    placeholderTextColor={colors.textDim}
                    value={shareEmail}
                    onChangeText={(v) => {
                      setShareEmail(v);
                      setShareError(null);
                    }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable
                    onPress={handleShareAdd}
                    disabled={sharingBusy || !shareEmail.trim()}
                    style={[
                      styles.shareAddBtn,
                      {
                        backgroundColor: colors.brand,
                        opacity:
                          sharingBusy || !shareEmail.trim() ? 0.5 : 1,
                      },
                    ]}
                  >
                    <Text style={styles.shareAddBtnText}>
                      {sharingBusy ? "..." : "Dodaj"}
                    </Text>
                  </Pressable>
                </View>

                {shareError ? (
                  <Text
                    style={[
                      styles.shareError,
                      { color: colors.error },
                    ]}
                  >
                    {shareError}
                  </Text>
                ) : null}
              </Card>
            </>
          ) : null}

          {/* Bottom back button */}
          {artifact || isFailed || loadError ? (
            <PrimaryButton
              label="Nazad"
              onPress={onBack}
              variant="secondary"
            />
          ) : null}
        </ScrollView>

        {/* ---- Audio player bar (sticky bottom) ---- */}
        {audioFiles.length > 0 ? (
          <AudioPlayerBar
            ref={playerRef}
            audioFiles={audioFiles}
            token={token}
            meetingId={meeting.id}
            onTimeUpdate={handlePlayerTimeUpdate}
          />
        ) : null}
      </Animated.View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  container: {
    padding: 20,
    gap: 14,
    paddingBottom: 120,
  },

  // Section divider
  sectionDivider: {
    height: 1,
    marginVertical: 2,
  },

  // Processing spinner
  processingSpinnerOuter: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 4,
  },

  // Header row
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  exportBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  exportBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  exportToast: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  exportToastText: {
    fontSize: 13,
    fontWeight: "700",
  },

  // Back button
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingVertical: 8,
    paddingRight: 12,
  },
  backArrow: {
    fontSize: 18,
    fontWeight: "600",
  },
  backLabel: {
    fontSize: 15,
    fontWeight: "600",
  },

  // Header
  title: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaText: {
    fontSize: 13,
    fontWeight: "500",
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },

  // Participant chips
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "700",
  },

  // Cards
  card: {
    borderColor: "transparent",
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 16,
    overflow: "hidden",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  sectionBody: {
    fontSize: 14,
    lineHeight: 21,
  },

  // Review banner
  reviewBanner: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  reviewText: {
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },

  // Action Items
  actionRow: {
    gap: 6,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  actionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    marginTop: 1,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
    lineHeight: 20,
  },
  actionTagRow: {
    flexDirection: "row",
    gap: 8,
    paddingLeft: 28,
  },
  actionTag: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  actionTagText: {
    fontSize: 11,
    fontWeight: "700",
  },
  confidenceBar: {
    height: 3,
    borderRadius: 2,
    marginTop: 2,
    marginLeft: 28,
  },
  confidenceFill: {
    height: 3,
    borderRadius: 2,
  },

  // Transcript
  transcriptRow: {
    gap: 4,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  transcriptHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  transcriptSpeaker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  speakerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  speakerName: {
    fontSize: 13,
    fontWeight: "700",
  },
  timeRange: {
    fontSize: 11,
    fontWeight: "500",
  },
  lowConfidenceBadge: {
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  lowConfidenceText: {
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  transcriptText: {
    fontSize: 14,
    lineHeight: 21,
    paddingLeft: 18,
  },

  // Speaker mapping
  speakerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  speakerLabel: {
    fontSize: 13,
    fontWeight: "700",
    minWidth: 80,
  },
  speakerInput: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  speakerBtnRow: {
    alignItems: "center",
    marginTop: 6,
  },
  speakerSaveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
  },
  speakerSaveBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  speakerSuccessToast: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  speakerSuccessText: {
    fontSize: 13,
    fontWeight: "700",
  },

  // Decisions
  decisionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  decisionNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  decisionNumberText: {
    fontSize: 11,
    fontWeight: "800",
  },

  // Minutes
  minuteRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  bulletChar: {
    fontSize: 16,
    lineHeight: 21,
  },

  // Risks
  riskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  riskIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  riskIcon: {
    fontSize: 13,
    fontWeight: "800",
  },
  riskBody: {
    fontSize: 14,
    lineHeight: 21,
    flex: 1,
  },

  // Open questions
  questionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  questionMarkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  questionMark: {
    fontSize: 13,
    fontWeight: "800",
  },

  // Processing state
  processingContainer: {
    flex: 1,
    padding: 20,
  },
  processingContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  processingSpacing: {
    height: 16,
  },
  processingTitle: {
    fontSize: 22,
    fontWeight: "800",
  },
  processingSubtitle: {
    fontSize: 14,
    textAlign: "center",
  },
  processingMeetingTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginTop: 8,
    textAlign: "center",
  },

  // Progress bar
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    width: "80%",
    marginTop: 8,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 6,
    borderRadius: 3,
  },

  // Partial transcript preview
  partialTranscriptContainer: {
    marginTop: 20,
    width: "100%",
    maxHeight: 220,
    paddingHorizontal: 16,
  },
  partialTranscriptTitle: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  partialTranscriptScroll: {
    maxHeight: 180,
  },
  partialSegmentRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
  },
  partialSpeaker: {
    fontSize: 12,
    fontWeight: "700",
    minWidth: 80,
  },
  partialText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },

  // Error state
  errorCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  errorBody: {
    fontSize: 13,
    lineHeight: 18,
  },

  // Loading inline
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 24,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: "500",
  },

  // Sharing section
  shareRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 10,
  },
  shareEmail: {
    fontSize: 14,
    flex: 1,
  },
  revokeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  revokeBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  shareEmpty: {
    fontSize: 14,
    fontStyle: "italic",
    paddingVertical: 8,
  },
  shareAddRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  shareInput: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  shareAddBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  shareAddBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  shareError: {
    fontSize: 13,
    lineHeight: 18,
  },

  // Empty states
  emptyStateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  emptyStateInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  emptyStateIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    textAlign: "center",
    lineHeight: 22,
    fontSize: 13,
    fontWeight: "800",
    fontStyle: "italic",
    overflow: "hidden",
    backgroundColor: "rgba(128,128,128,0.12)",
  },
  emptyStateText: {
    fontSize: 14,
    fontStyle: "italic",
    flex: 1,
  },

  // Retry button (for load errors)
  retryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  retryBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
});
