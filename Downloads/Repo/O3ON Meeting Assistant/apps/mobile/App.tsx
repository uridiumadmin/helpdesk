import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { appConfig } from "./src/config";
import { api, setOnAuthExpired } from "./src/lib/api";
import { dropSession, loadSession, persistSession, signInWithCredentials } from "./src/lib/auth";
import type { AuthSession, Meeting } from "./src/types";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { AuthScreen } from "./src/screens/AuthScreen";
import { MeetingsScreen } from "./src/screens/MeetingsScreen";
import { RecordingScreen } from "./src/screens/RecordingScreen";
import { MeetingDetailScreen } from "./src/screens/MeetingDetailScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";

// ---------------------------------------------------------------------------
// PWA install prompt helpers (web only)
// ---------------------------------------------------------------------------

const PWA_DISMISS_KEY = "pwa_install_dismissed_at";
const PWA_DISMISS_DAYS = 7;

function isPwaDismissed(): boolean {
  if (Platform.OS !== "web") return true;
  try {
    const raw = localStorage.getItem(PWA_DISMISS_KEY);
    if (!raw) return false;
    const dismissedAt = Number(raw);
    const elapsed = Date.now() - dismissedAt;
    return elapsed < PWA_DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function dismissPwa(): void {
  try {
    localStorage.setItem(PWA_DISMISS_KEY, String(Date.now()));
  } catch {}
}

function PwaInstallBanner() {
  const [visible, setVisible] = useState(false);
  const promptRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (isPwaDismissed()) return;

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      promptRef.current = e;
      setVisible(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall as any);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall as any);
    };
  }, []);

  if (!visible || Platform.OS !== "web") return null;

  async function handleInstall() {
    const prompt = promptRef.current;
    if (!prompt) return;
    prompt.prompt();
    const result = await prompt.userChoice;
    if (result?.outcome === "accepted") {
      setVisible(false);
    }
    promptRef.current = null;
  }

  function handleDismiss() {
    dismissPwa();
    setVisible(false);
  }

  return (
    <View style={pwaBannerStyles.container}>
      <Text style={pwaBannerStyles.text}>
        Instalirajte O3ON za bolje iskustvo
      </Text>
      <View style={pwaBannerStyles.actions}>
        <Pressable onPress={handleInstall} style={pwaBannerStyles.installBtn}>
          <Text style={pwaBannerStyles.installBtnText}>Instaliraj</Text>
        </Pressable>
        <Pressable onPress={handleDismiss} style={pwaBannerStyles.dismissBtn}>
          <Text style={pwaBannerStyles.dismissBtnText}>X</Text>
        </Pressable>
      </View>
    </View>
  );
}

const pwaBannerStyles = StyleSheet.create({
  container: {
    backgroundColor: "#E2B714",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  text: {
    color: "#1A1A1A",
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  installBtn: {
    backgroundColor: "#1A1A1A",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  installBtnText: {
    color: "#E2B714",
    fontSize: 13,
    fontWeight: "700",
  },
  dismissBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(26,26,26,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  dismissBtnText: {
    color: "#1A1A1A",
    fontSize: 13,
    fontWeight: "800",
  },
});

type AppView = "auth" | "home" | "recording" | "detail" | "profile";

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

  // Auto-logout on 401 (expired token)
  useEffect(() => {
    setOnAuthExpired(() => {
      handleSignOut();
    });
    return () => setOnAuthExpired(null);
  });

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
      <PwaInstallBanner />
      {view === "auth" && <AuthScreen onSignIn={handleSignIn} />}
      {view === "home" && session && (
        <MeetingsScreen
          token={token}
          user={session.user}
          onRecord={openRecording}
          onOpenMeeting={openDetail}
          onSignOut={handleSignOut}
          onProfile={() => setView("profile")}
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
      {view === "detail" && activeMeeting && session && (
        <MeetingDetailScreen
          meeting={activeMeeting}
          token={token}
          onBack={goHome}
          currentUserId={session.user.id}
        />
      )}
      {view === "profile" && session && (
        <ProfileScreen
          token={token}
          user={session.user}
          onBack={goHome}
          onUpdated={(updatedUser) => {
            setSession((prev) =>
              prev ? { ...prev, user: updatedUser } : prev,
            );
          }}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </ErrorBoundary>
  );
}
