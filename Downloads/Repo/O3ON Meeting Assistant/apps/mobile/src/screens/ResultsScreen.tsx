import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "../components/PrimaryButton";
import { useProcessingStatus } from "../hooks/useProcessingStatus";
import { api } from "../lib/api";
import type { Meeting, MeetingArtifact } from "../types";

type Props = {
  meeting: Meeting;
  token: string;
  recordingUri?: string | null;
  onBack: () => void;
};

const speakerColors = ["#60A5FA", "#34D399", "#F472B6", "#FBBF24", "#A78BFA", "#FB923C"];

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function speakerColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  return speakerColors[Math.abs(hash) % speakerColors.length];
}

export function ResultsScreen({ meeting, token, recordingUri, onBack }: Props) {
  const { isProcessing, isReady, isFailed, error: statusError } = useProcessingStatus(
    token,
    meeting.id,
    true
  );

  const [artifact, setArtifact] = useState<MeetingArtifact | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;

    async function fetchArtifacts() {
      try {
        const result = await api.getArtifacts(token, meeting.id);
        if (!cancelled) setArtifact(result);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load results");
        }
      }
    }

    void fetchArtifacts();
    return () => { cancelled = true; };
  }, [isReady, token, meeting.id]);

  return (
    <View style={styles.root}>
      <Text style={styles.kicker}>Rezultati sastanka</Text>
      <Text style={styles.title}>{meeting.title}</Text>

      {isProcessing ? (
        <View style={styles.processingCard}>
          <ActivityIndicator color="#E2B714" size="large" />
          <Text style={styles.processingText}>Obrada u toku...</Text>
          <Text style={styles.meta}>Transkripcija i sumarizacija audio snimka</Text>
        </View>
      ) : null}

      {isFailed ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Obrada neuspešna</Text>
          <Text style={styles.errorBody}>{statusError ?? "Došlo je do greške tokom obrade."}</Text>
        </View>
      ) : null}

      {loadError ? (
        <Text style={styles.errorBody}>{loadError}</Text>
      ) : null}

      {artifact ? (
        <>
          {artifact.needsReview ? (
            <View style={styles.reviewBanner}>
              <Text style={styles.reviewText}>Potrebna revizija — proverite rezultate pre deljenja</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Rezime</Text>
            <Text style={styles.sectionBody}>{artifact.summary}</Text>
          </View>

          {artifact.transcript.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Transkript ({artifact.transcript.length} segmenata)</Text>
              {artifact.transcript.map((seg) => (
                <View key={seg.id} style={styles.transcriptRow}>
                  <View style={styles.transcriptHeader}>
                    <View style={[styles.speakerDot, { backgroundColor: speakerColor(seg.speakerLabel) }]} />
                    <Text style={styles.speakerName}>{seg.speakerName ?? seg.speakerLabel}</Text>
                    <Text style={styles.timeRange}>{formatTime(seg.startMs)} – {formatTime(seg.endMs)}</Text>
                    {seg.confidence < 0.5 ? (
                      <Text style={styles.lowConfidence}>nizak</Text>
                    ) : null}
                  </View>
                  <Text style={styles.transcriptText}>{seg.text}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {artifact.minutes.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Zapisnik</Text>
              {artifact.minutes.map((item, i) => (
                <Text key={i} style={styles.sectionBody}>• {item}</Text>
              ))}
            </View>
          ) : null}

          {artifact.decisions.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Odluke</Text>
              {artifact.decisions.map((item, i) => (
                <Text key={i} style={styles.sectionBody}>{i + 1}. {item}</Text>
              ))}
            </View>
          ) : null}

          {artifact.risks && artifact.risks.length > 0 ? (
            <View style={[styles.card, styles.riskCard]}>
              <Text style={styles.riskTitle}>Rizici</Text>
              {artifact.risks.map((item, i) => (
                <Text key={i} style={styles.riskBody}>⚠ {item}</Text>
              ))}
            </View>
          ) : null}

          {artifact.openQuestions && artifact.openQuestions.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Otvorena pitanja</Text>
              {artifact.openQuestions.map((item, i) => (
                <Text key={i} style={styles.sectionBody}>? {item}</Text>
              ))}
            </View>
          ) : null}

          {artifact.actionItems.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Akcije</Text>
              {artifact.actionItems.map((item) => (
                <View key={item.id} style={styles.actionRow}>
                  <Text style={styles.actionTitle}>{item.title}</Text>
                  <View style={styles.actionMeta}>
                    {item.owner ? <Text style={styles.meta}>Zadužen: {item.owner}</Text> : null}
                    {item.dueDate ? <Text style={styles.meta}>Rok: {item.dueDate}</Text> : null}
                  </View>
                  <View style={styles.confidenceBar}>
                    <View style={[styles.confidenceFill, { width: `${Math.round(item.confidence * 100)}%` }]} />
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {recordingUri ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Snimak</Text>
          <Text style={styles.meta}>{recordingUri}</Text>
        </View>
      ) : null}

      <PrimaryButton label="Nazad" onPress={onBack} variant="secondary" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  kicker: { color: "#E2B714", fontSize: 13, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  title: { color: "#F8FAFC", fontSize: 24, fontWeight: "800" },
  meta: { color: "#94A3B8", fontSize: 13 },
  card: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  sectionTitle: { color: "#F8FAFC", fontSize: 16, fontWeight: "800" },
  sectionBody: { color: "#CBD5E1", fontSize: 14, lineHeight: 20 },
  processingCard: {
    alignItems: "center",
    backgroundColor: "rgba(226,183,20,0.08)",
    borderColor: "rgba(226,183,20,0.2)",
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    padding: 28,
  },
  processingText: { color: "#E2B714", fontSize: 18, fontWeight: "800" },
  errorCard: {
    backgroundColor: "rgba(239,68,68,0.1)",
    borderColor: "rgba(239,68,68,0.3)",
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  errorTitle: { color: "#FCA5A5", fontSize: 16, fontWeight: "800" },
  errorBody: { color: "#FCA5A5", fontSize: 13, lineHeight: 18 },
  reviewBanner: {
    backgroundColor: "rgba(251,191,36,0.12)",
    borderColor: "rgba(251,191,36,0.3)",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  reviewText: { color: "#FBBF24", fontSize: 14, fontWeight: "700", textAlign: "center" },
  transcriptRow: { gap: 4, paddingVertical: 6, borderBottomColor: "rgba(255,255,255,0.04)", borderBottomWidth: 1 },
  transcriptHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  speakerDot: { width: 10, height: 10, borderRadius: 5 },
  speakerName: { color: "#F8FAFC", fontSize: 13, fontWeight: "700" },
  timeRange: { color: "#64748B", fontSize: 11 },
  lowConfidence: { color: "#FCA5A5", fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  transcriptText: { color: "#CBD5E1", fontSize: 14, lineHeight: 20, paddingLeft: 18 },
  riskCard: { backgroundColor: "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.2)" },
  riskTitle: { color: "#F59E0B", fontSize: 16, fontWeight: "800" },
  riskBody: { color: "#FCD34D", fontSize: 14, lineHeight: 20 },
  actionRow: { gap: 4, paddingVertical: 6 },
  actionTitle: { color: "#F8FAFC", fontSize: 14, fontWeight: "700" },
  actionMeta: { flexDirection: "row", gap: 16 },
  confidenceBar: { height: 4, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 2, marginTop: 4 },
  confidenceFill: { height: 4, backgroundColor: "#34D399", borderRadius: 2 },
});
