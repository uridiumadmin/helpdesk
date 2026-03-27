import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { Audio } from "expo-av";
import { PrimaryButton } from "../components/PrimaryButton";
import { recordingDefaults } from "../config";
import { api } from "../lib/api";
import type { Meeting } from "../types";

type Props = {
  meeting: Meeting;
  token: string;
  onDone: (payload: { recordingUri: string | null; nextStatus: Meeting["status"] }) => void;
};

export function RecordingScreen({ meeting, onDone, token }: Props) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [capturedDurationSeconds, setCapturedDurationSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadState, setUploadState] = useState<string | null>(null);
  const isRecording = useMemo(() => Boolean(recording), [recording]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (isRecording) {
      timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    }
    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [isRecording]);

  useEffect(() => {
    void activateKeepAwakeAsync();
    return () => {
      deactivateKeepAwake();
    };
  }, []);

  async function start() {
    setError(null);
    try {
      try {
        await api.startRecording(token, meeting.id);
      } catch {
        // Local recording should still work even if the backend marker fails.
      }

      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Microphone permission is required");
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false
      });

      const nextRecording = new Audio.Recording();
      await nextRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await nextRecording.startAsync();
      setRecording(nextRecording);
      setSeconds(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start recording");
    }
  }

  async function stop() {
    if (!recording) {
      return;
    }

    await recording.stopAndUnloadAsync();
    const nextUri = recording.getURI();
    setRecording(null);
    setUri(nextUri ?? null);
    setCapturedDurationSeconds(Math.max(seconds, 1));
  }

  async function uploadAndProcess() {
    if (!uri) {
      return;
    }

    setUploading(true);
    setError(null);

    try {
      setUploadState("Creating upload session...");
      const uploadSession = await api.requestUploadSession(token, meeting.id);
      setUploadState("Uploading audio...");
      await api.uploadRecordingFile(token, meeting.id, uploadSession.uploadUrl, uri);
      setUploadState("Triggering transcript processing...");
      await api.completeUploadWithDuration(
        token,
        meeting.id,
        uploadSession.uploadId,
        Math.max(capturedDurationSeconds ?? seconds, 1)
      );
      onDone({ recordingUri: uri, nextStatus: "processing" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to upload recording");
    } finally {
      setUploading(false);
      setUploadState(null);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.kicker}>Recording</Text>
      <Text style={styles.title}>{meeting.title}</Text>
      <Text style={styles.body}>
        Screen stays awake while recording is active. Raw audio can be chunked and uploaded after the meeting.
      </Text>

      <View style={styles.card}>
        <Text style={styles.metric}>{String(seconds).padStart(2, "0")} sec</Text>
        <Text style={styles.meta}>{recordingDefaults.language} · chunk {recordingDefaults.chunkSeconds}s</Text>
        <Text style={styles.meta}>{isRecording ? "Mic live" : uploading ? "Uploading" : "Idle"}</Text>
        {capturedDurationSeconds ? <Text style={styles.meta}>Captured {capturedDurationSeconds}s</Text> : null}
      </View>

      <View style={styles.actions}>
        <PrimaryButton disabled={isRecording || uploading} label="Start recording" onPress={() => void start()} />
        <PrimaryButton
          disabled={!isRecording || uploading}
          label="Stop recording"
          onPress={() => void stop()}
          variant="secondary"
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {uploadState ? <Text style={styles.meta}>{uploadState}</Text> : null}

      {uri ? (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>Captured</Text>
          <Text style={styles.resultBody}>{uri}</Text>
          <PrimaryButton
            disabled={uploading}
            label={uploading ? "Uploading..." : "Upload and process"}
            onPress={() => void uploadAndProcess()}
            variant="ghost"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 14
  },
  kicker: {
    color: "#E2B714",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  title: {
    color: "#F8FAFC",
    fontSize: 24,
    fontWeight: "800"
  },
  body: {
    color: "#94A3B8",
    fontSize: 14,
    lineHeight: 20
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 22,
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    gap: 8,
    padding: 18
  },
  metric: {
    color: "#F8FAFC",
    fontSize: 32,
    fontWeight: "900"
  },
  meta: {
    color: "#94A3B8",
    fontSize: 13
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap"
  },
  resultCard: {
    backgroundColor: "#0B1728",
    borderColor: "rgba(226,183,20,0.22)",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16
  },
  resultTitle: {
    color: "#E2B714",
    fontSize: 15,
    fontWeight: "800"
  },
  resultBody: {
    color: "#CBD5E1",
    fontSize: 12
  },
  error: {
    color: "#FCA5A5",
    fontSize: 13,
    lineHeight: 18
  }
});
