import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { PrimaryButton } from "../components/PrimaryButton";
import { useTheme } from "../theme/ThemeContext";
import { useProcessingStatus } from "../hooks/useProcessingStatus";
import { api } from "../lib/api";
import type { Meeting, MeetingArtifact } from "../types";

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

export function MeetingDetailScreen({ meeting, token, onBack }: {
  meeting: Meeting;
  token: string;
  onBack: () => void;
}) {
  const { colors, isDark } = useTheme();
  const {
    isProcessing,
    isReady,
    isFailed,
    error: statusError,
  } = useProcessingStatus(token, meeting.id, true);

  const [artifact, setArtifact] = useState<MeetingArtifact | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
              : "Neuspesno ucitavanje rezultata",
          );
        }
      }
    }

    void fetchArtifacts();
    return () => {
      cancelled = true;
    };
  }, [isReady, token, meeting.id]);

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
              Obrada u toku...
            </Text>
            <Text
              style={[
                styles.processingSubtitle,
                { color: colors.textDim },
              ]}
            >
              Transkripcija i analiza vaseg snimka
            </Text>
            <Text
              style={[
                styles.processingMeetingTitle,
                { color: colors.textMuted },
              ]}
            >
              {meeting.title}
            </Text>
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
                Obrada neuspesna
              </Text>
              <Text style={[styles.errorBody, { color: colors.error }]}>
                {statusError ?? "Doslo je do greske tokom obrade."}
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
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
        >
          {/* ---- Header section ---- */}
          <BackButton />

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
                    ? "ucesnik"
                    : "ucesnika"}
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
            <Text style={[styles.errorBody, { color: colors.error }]}>
              {loadError}
            </Text>
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
                Ucitavanje rezultata...
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
                      return (
                        <View
                          key={seg.id}
                          style={[
                            styles.transcriptRow,
                            {
                              borderBottomColor:
                                colors.separator,
                            },
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
                                {seg.speakerName ??
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
                        </View>
                      );
                    })}
                  </Card>
                  <SectionDivider />
                </>
              ) : null}

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

          {/* Bottom back button */}
          {artifact || isFailed || loadError ? (
            <PrimaryButton
              label="Nazad"
              onPress={onBack}
              variant="secondary"
            />
          ) : null}
        </ScrollView>
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
    paddingBottom: 40,
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
});
