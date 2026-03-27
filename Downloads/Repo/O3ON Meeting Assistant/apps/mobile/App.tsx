import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { Screen } from "./src/components/Screen";
import { appConfig } from "./src/config";
import { api } from "./src/lib/api";
import { dropSession, loadSession, persistSession, signInWithCredentials } from "./src/lib/auth";
import type { AuthSession, Meeting } from "./src/types";
import { AuthScreen } from "./src/screens/AuthScreen";
import { MeetingsScreen } from "./src/screens/MeetingsScreen";
import { RecordingScreen } from "./src/screens/RecordingScreen";
import { ResultsScreen } from "./src/screens/ResultsScreen";

type AppView = "dashboard" | "recording" | "results";

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<AppView>("dashboard");
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const storedSession = await loadSession();
      if (mounted) {
        setSession(storedSession);
        setBootstrapping(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleSignIn(email: string, password: string) {
    setBusy(true);
    try {
      try {
        const remoteSession = await api.signIn({ email, password });
        await persistSession(remoteSession);
        setSession(remoteSession);
      } catch (cause) {
        if (appConfig.authStrategy !== "local-dev") {
          throw cause;
        }
        const localSession = await signInWithCredentials({ email, password });
        await persistSession(localSession);
        setSession(localSession);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    if (session) {
      try {
        await api.signOut(session.accessToken);
      } catch {
        // Session is local-first for the scaffold; backend signout is best-effort.
      }
    }
    await dropSession();
    setSession(null);
    setActiveMeeting(null);
    setRecordingUri(null);
    setView("dashboard");
  }

  if (bootstrapping) {
    return (
      <View style={styles.loading}>
        <View style={styles.orbOne} />
        <View style={styles.orbTwo} />
        <StatusBar style="light" />
        <Text style={styles.loadingText}>Loading {appConfig.appName}...</Text>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.background}>
        <View style={styles.heroBackdrop} />
        <StatusBar style="light" />
        <Screen
          subtitle="A secure, mobile-first shell for Serbian meeting capture and post-processing."
          title={appConfig.appName}
        >
          <AuthScreen busy={busy} onSignIn={handleSignIn} />
        </Screen>
      </View>
    );
  }

  return (
    <View style={styles.background}>
      <View style={styles.heroBackdrop} />
      <StatusBar style="light" />
      <Screen
        subtitle={`${session.user.fullName} · ${session.organization?.name ?? "No organization"}`}
        title="Meeting workspace"
      >
        {view === "dashboard" ? (
          <View style={styles.stack}>
            <View style={styles.heroCard}>
              <Text style={styles.heroKicker}>Signed in</Text>
              <Text style={styles.heroTitle}>Capture meetings, preserve speaker context, and generate minutes.</Text>
              <Text style={styles.heroBody}>
                The backend will own AI secrets, chunking, diarization, and transcript synthesis.
              </Text>
            </View>
            {activeMeeting ? (
              <View style={styles.detailCard}>
                <Text style={styles.detailLabel}>Selected meeting</Text>
                <Text style={styles.detailTitle}>{activeMeeting.title}</Text>
                <Text style={styles.detailBody}>
                  {activeMeeting.participants.length} participants · {activeMeeting.status} · {activeMeeting.durationMinutes} min
                </Text>
                <View style={styles.detailActions}>
                  <Text style={styles.detailAction} onPress={() => setView("recording")}>
                    Start recording
                  </Text>
                  <Text style={styles.detailAction} onPress={() => setView("results")}>
                    View results
                  </Text>
                </View>
              </View>
            ) : null}
            <MeetingsScreen
              onOpenMeeting={(meeting) => {
                setActiveMeeting(meeting);
              }}
              onOpenResults={(meeting) => {
                setActiveMeeting(meeting);
                setView("results");
              }}
              onStartRecording={(meeting) => {
                setActiveMeeting(meeting);
                setView("recording");
              }}
              token={session.accessToken}
            />
            <View style={styles.footer}>
              <Text style={styles.footerMeta}>Auth strategy: {appConfig.authStrategy}</Text>
              <Text style={styles.footerMeta}>API: {appConfig.apiBaseUrl}</Text>
              <Text style={styles.footerAction} onPress={() => void handleSignOut()}>
                Sign out
              </Text>
            </View>
          </View>
        ) : null}

        {view === "recording" && activeMeeting ? (
          <RecordingScreen
            meeting={activeMeeting}
            token={session.accessToken}
            onDone={({ recordingUri: nextRecordingUri, nextStatus }) => {
              setRecordingUri(nextRecordingUri);
              setActiveMeeting((current) => (current ? { ...current, status: nextStatus } : current));
              setView("results");
            }}
          />
        ) : null}

        {view === "results" && activeMeeting ? (
          <ResultsScreen
            meeting={activeMeeting}
            token={session.accessToken}
            onBack={() => setView("dashboard")}
            recordingUri={recordingUri}
          />
        ) : null}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "#07111F"
  },
  heroBackdrop: {
    position: "absolute",
    top: -120,
    right: -60,
    height: 240,
    width: 240,
    borderRadius: 999,
    backgroundColor: "rgba(29,78,216,0.15)"
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#07111F"
  },
  orbOne: {
    position: "absolute",
    top: 100,
    left: 30,
    height: 120,
    width: 120,
    borderRadius: 999,
    backgroundColor: "rgba(29,78,216,0.25)"
  },
  orbTwo: {
    position: "absolute",
    top: 80,
    right: 22,
    height: 72,
    width: 72,
    borderRadius: 999,
    backgroundColor: "rgba(226,183,20,0.2)"
  },
  loadingText: {
    color: "#F8FAFC",
    fontSize: 18,
    fontWeight: "700"
  },
  stack: {
    gap: 16
  },
  heroCard: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    padding: 18
  },
  heroKicker: {
    color: "#E2B714",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  heroTitle: {
    color: "#F8FAFC",
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800"
  },
  heroBody: {
    color: "#9CA3AF",
    fontSize: 14,
    lineHeight: 20
  },
  detailCard: {
    backgroundColor: "#0B1728",
    borderColor: "rgba(226,183,20,0.18)",
    borderRadius: 22,
    borderWidth: 1,
    gap: 8,
    padding: 16
  },
  detailLabel: {
    color: "#E2B714",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  detailTitle: {
    color: "#F8FAFC",
    fontSize: 18,
    fontWeight: "800"
  },
  detailBody: {
    color: "#CBD5E1",
    fontSize: 13,
    lineHeight: 18
  },
  detailActions: {
    flexDirection: "row",
    gap: 14
  },
  detailAction: {
    color: "#E2B714",
    fontSize: 13,
    fontWeight: "700"
  },
  footer: {
    gap: 4,
    paddingBottom: 24
  },
  footerMeta: {
    color: "#64748B",
    fontSize: 12
  },
  footerAction: {
    color: "#E2B714",
    fontSize: 13,
    fontWeight: "700"
  }
});
