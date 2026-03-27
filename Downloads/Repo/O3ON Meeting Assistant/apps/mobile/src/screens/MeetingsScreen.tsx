import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { PrimaryButton } from "../components/PrimaryButton";
import { api, mockArtifacts } from "../lib/api";
import type { Meeting } from "../types";

type Props = {
  token: string;
  onOpenMeeting: (meeting: Meeting) => void;
  onStartRecording: (meeting: Meeting) => void;
  onOpenResults: (meeting: Meeting) => void;
};

export function MeetingsScreen({ token, onOpenMeeting, onStartRecording, onOpenResults }: Props) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [title, setTitle] = useState("Novi sastanak");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [participantsInput, setParticipantsInput] = useState("Ana, Marko");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const response = await api.listMeetings(token);
        if (mounted) {
          setMeetings(response);
        }
      } catch {
        if (mounted) {
          setMeetings([
            {
              id: "meeting-1",
              title: "QBR za prodaju i operacije",
              startsAt: "2026-03-27T09:00:00.000Z",
              durationMinutes: 60,
              status: "ready",
              language: "sr-RS",
              participants: [
                { id: "p1", name: "Miloš", enrollmentStatus: "enrolled", speakerLabel: "speaker-1" },
                { id: "p2", name: "Jelena", enrollmentStatus: "enrolled", speakerLabel: "speaker-2" }
              ],
              summary: mockArtifacts().summary,
              actionItems: mockArtifacts().actionItems
            }
          ]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [token]);

  async function createMeeting() {
    setCreating(true);
    setCreateError(null);

    try {
      const participantNames = participantsInput
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const createdMeeting = await api.createMeeting(token, {
        title: title.trim() || "Novi sastanak",
        startsAt: new Date().toISOString(),
        durationMinutes: Math.max(1, Number.parseInt(durationMinutes, 10) || 30),
        participantNames
      });

      setMeetings((current) => [createdMeeting, ...current]);
      onOpenMeeting(createdMeeting);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Unable to create meeting");
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text style={styles.toolbarTitle}>Meetings</Text>
        <Text style={styles.toolbarMeta}>{loading ? "Syncing..." : `${meetings.length} loaded`}</Text>
      </View>
      <View style={styles.createCard}>
        <Text style={styles.createTitle}>Create meeting</Text>
        <TextInput onChangeText={setTitle} style={styles.input} value={title} placeholder="Meeting title" placeholderTextColor="#64748B" />
        <TextInput
          keyboardType="number-pad"
          onChangeText={setDurationMinutes}
          style={styles.input}
          value={durationMinutes}
          placeholder="Duration in minutes"
          placeholderTextColor="#64748B"
        />
        <TextInput
          onChangeText={setParticipantsInput}
          style={[styles.input, styles.multilineInput]}
          value={participantsInput}
          placeholder="Participants, separated by commas"
          placeholderTextColor="#64748B"
          multiline
        />
        {createError ? <Text style={styles.error}>{createError}</Text> : null}
        <PrimaryButton
          disabled={creating}
          label={creating ? "Creating..." : "Create meeting"}
          onPress={() => void createMeeting()}
        />
      </View>
      <View style={styles.stack}>
        {meetings.map((meeting) => (
          <View key={meeting.id} style={styles.card}>
            <Text style={styles.title}>{meeting.title}</Text>
            <Text style={styles.meta}>
              {new Date(meeting.startsAt).toLocaleString()} · {meeting.durationMinutes} min · {meeting.status}
            </Text>
            <Text style={styles.body}>{meeting.summary ?? "Ready for processing."}</Text>
            <View style={styles.actions}>
              <PrimaryButton label="Open" onPress={() => onOpenMeeting(meeting)} variant="secondary" />
              <PrimaryButton label="Record" onPress={() => onStartRecording(meeting)} />
              <PrimaryButton label="Results" onPress={() => onOpenResults(meeting)} variant="ghost" />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 14
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline"
  },
  toolbarTitle: {
    color: "#F8FAFC",
    fontSize: 24,
    fontWeight: "800"
  },
  toolbarMeta: {
    color: "#94A3B8",
    fontSize: 13
  },
  stack: {
    gap: 14
  },
  createCard: {
    backgroundColor: "#0B1728",
    borderColor: "rgba(226,183,20,0.18)",
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    padding: 16
  },
  createTitle: {
    color: "#F8FAFC",
    fontSize: 18,
    fontWeight: "800"
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    padding: 16
  },
  title: {
    color: "#F8FAFC",
    fontSize: 18,
    fontWeight: "800"
  },
  meta: {
    color: "#94A3B8",
    fontSize: 13
  },
  body: {
    color: "#CBD5E1",
    fontSize: 14,
    lineHeight: 20
  },
  input: {
    backgroundColor: "#07111F",
    borderColor: "rgba(148,163,184,0.25)",
    borderRadius: 14,
    borderWidth: 1,
    color: "#F8FAFC",
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  multilineInput: {
    minHeight: 72,
    textAlignVertical: "top"
  },
  error: {
    color: "#FCA5A5",
    fontSize: 13,
    lineHeight: 18
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap"
  }
});
