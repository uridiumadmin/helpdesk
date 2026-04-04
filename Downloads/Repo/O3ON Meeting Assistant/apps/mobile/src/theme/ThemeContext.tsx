import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Platform, useColorScheme } from "react-native";

export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

export interface ThemeColors {
  // Backgrounds
  bg: string;
  bgCard: string;
  bgCardHover: string;
  bgInput: string;
  bgOverlay: string;

  // Text
  text: string;
  textMuted: string;
  textDim: string;

  // Accent
  accent: string;
  accentMuted: string;
  accentBg: string;

  // Brand (O3ON blue)
  brand: string;
  brandLight: string;
  brandBg: string;

  // Status
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  error: string;
  errorBg: string;
  recording: string;
  recordingBg: string;

  // Borders
  border: string;
  borderLight: string;

  // Misc
  shadow: string;
  separator: string;
}

const darkColors: ThemeColors = {
  bg: "#0A0F1E",
  bgCard: "rgba(255,255,255,0.06)",
  bgCardHover: "rgba(255,255,255,0.10)",
  bgInput: "rgba(255,255,255,0.08)",
  bgOverlay: "rgba(0,0,0,0.6)",
  text: "#F8FAFC",
  textMuted: "#94A3B8",
  textDim: "#64748B",
  accent: "#E91E63",
  accentMuted: "rgba(233,30,99,0.6)",
  accentBg: "rgba(233,30,99,0.12)",
  brand: "#1565C0",
  brandLight: "#42A5F5",
  brandBg: "rgba(21,101,192,0.15)",
  success: "#34D399",
  successBg: "rgba(52,211,153,0.12)",
  warning: "#FBBF24",
  warningBg: "rgba(251,191,36,0.12)",
  error: "#F87171",
  errorBg: "rgba(248,113,113,0.12)",
  recording: "#EF4444",
  recordingBg: "rgba(239,68,68,0.15)",
  border: "rgba(255,255,255,0.10)",
  borderLight: "rgba(255,255,255,0.05)",
  shadow: "rgba(0,0,0,0.3)",
  separator: "rgba(255,255,255,0.06)",
};

const lightColors: ThemeColors = {
  bg: "#F8FAFC",
  bgCard: "#FFFFFF",
  bgCardHover: "#F1F5F9",
  bgInput: "#F1F5F9",
  bgOverlay: "rgba(0,0,0,0.3)",
  text: "#0F172A",
  textMuted: "#64748B",
  textDim: "#94A3B8",
  accent: "#C2185B",
  accentMuted: "rgba(194,24,91,0.6)",
  accentBg: "rgba(194,24,91,0.10)",
  brand: "#1565C0",
  brandLight: "#1E88E5",
  brandBg: "rgba(21,101,192,0.08)",
  success: "#10B981",
  successBg: "rgba(16,185,129,0.08)",
  warning: "#F59E0B",
  warningBg: "rgba(245,158,11,0.08)",
  error: "#EF4444",
  errorBg: "rgba(239,68,68,0.08)",
  recording: "#DC2626",
  recordingBg: "rgba(220,38,38,0.08)",
  border: "rgba(0,0,0,0.10)",
  borderLight: "rgba(0,0,0,0.05)",
  shadow: "rgba(0,0,0,0.08)",
  separator: "rgba(0,0,0,0.06)",
};

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "auto",
  resolved: "dark",
  colors: darkColors,
  setMode: () => {},
  isDark: true,
});

// Simple storage abstraction for cross-platform
const storage = {
  async get(key: string): Promise<string | null> {
    try {
      if (Platform.OS === "web" && typeof localStorage !== "undefined") {
        return localStorage.getItem(key);
      }
      // On native, try dynamic import of expo-secure-store or AsyncStorage
      // For simplicity, we use a global fallback
      return null;
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === "web" && typeof localStorage !== "undefined") {
        localStorage.setItem(key, value);
      }
    } catch {}
  },
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("auto");

  useEffect(() => {
    (async () => {
      const saved = await storage.get("o3on.theme");
      if (saved === "light" || saved === "dark" || saved === "auto") {
        setModeState(saved);
      }
    })();
  }, []);

  function setMode(newMode: ThemeMode) {
    setModeState(newMode);
    void storage.set("o3on.theme", newMode);
  }

  const resolved: ResolvedTheme =
    mode === "auto" ? (systemScheme === "light" ? "light" : "dark") : mode;
  const colors = resolved === "light" ? lightColors : darkColors;

  return (
    <ThemeContext.Provider
      value={{ mode, resolved, colors, setMode, isDark: resolved === "dark" }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export { darkColors, lightColors };
