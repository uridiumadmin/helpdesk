import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { appConfig } from "./src/config";
import { api } from "./src/lib/api";
import { dropSession, loadSession, persistSession, signInWithCredentials } from "./src/lib/auth";
import type { AuthSession, Meeting } from "./src/types";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { AuthScreen } from "./src/screens/AuthScreen";
import { MeetingsScreen } from "./src/screens/MeetingsScreen";
import { RecordingScreen } from "./src/screens/RecordingScreen";
import { MeetingDetailScreen } from "./src/screens/MeetingDetailScreen";

type AppView = "auth" | "home" | "recording" | "detail";

function AppContent() {
  const { isDark } = useTheme();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [view, setView] = useState<AppView>("auth");
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await loadSession();
        if (stored) {
          setSession(stored as AuthSession);
          setView("home");
        }
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  async function handleSignIn(email: string, password: string) {
    try {
      const result = await api.signIn({ email, password });
      const authSession: AuthSession = {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken ?? null,
        user: result.user,
        organization: result.organization,
      };
      await persistSession(authSession);
      setSession(authSession);
      setView("home");
    } catch {
      if (appConfig.authStrategy !== "api") {
        const fallback = await signInWithCredentials({ email, password });
        await persistSession(fallback);
        setSession(fallback);
        setView("home");
      } else {
        throw new Error("Sign in failed");
      }
    }
  }

  async function handleSignOut() {
    try {
      await api.signOut(session?.accessToken ?? "");
    } catch {}
    await dropSession();
    setSession(null);
    setActiveMeeting(null);
    setView("auth");
  }

  function openRecording(meeting: Meeting) {
    setActiveMeeting(meeting);
    setView("recording");
  }

  function openDetail(meeting: Meeting) {
    setActiveMeeting(meeting);
    setView("detail");
  }

  function goHome() {
    setView("home");
  }

  if (bootstrapping) return null;

  const token = session?.accessToken ?? "";

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      {view === "auth" && <AuthScreen onSignIn={handleSignIn} />}
      {view === "home" && session && (
        <MeetingsScreen
          token={token}
          user={session.user}
          onRecord={openRecording}
          onOpenMeeting={openDetail}
          onSignOut={handleSignOut}
        />
      )}
      {view === "recording" && activeMeeting && (
        <RecordingScreen
          meeting={activeMeeting}
          token={token}
          onDone={() => setView("home")}
          onBack={() => setView("home")}
        />
      )}
      {view === "detail" && activeMeeting && (
        <MeetingDetailScreen
          meeting={activeMeeting}
          token={token}
          onBack={goHome}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
