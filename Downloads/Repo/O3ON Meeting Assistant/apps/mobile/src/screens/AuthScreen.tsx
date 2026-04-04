import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PrimaryButton } from "../components/PrimaryButton";
import { useTheme } from "../theme/ThemeContext";

const LOGO_URI = "/icon-512.png";

type Props = {
  onSignIn: (email: string, password: string) => Promise<void>;
};

/* ─────────────────────────────────────────────────────────────────────────────
 *  O3ON Atom Logo — built from Views to look like the atom/orbit brand mark
 * ───────────────────────────────────────────────────────────────────────────── */
function AppLogo({ scale }: { scale: Animated.Value }) {
  return (
    <Animated.View style={[styles.logoOuter, { transform: [{ scale }] }]}>
      <Image source={{ uri: LOGO_URI }} style={styles.logoImage} resizeMode="contain" />
    </Animated.View>
  );
}

export function AuthScreen({ onSignIn }: Props) {
  const { colors, isDark } = useTheme();
  const [email, setEmail] = useState("sasa@example.com");
  const [password, setPassword] = useState("meeting-assistant");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Animations ────────────────────────────────────────────────────────
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(40)).current;
  const logoScale = useRef(new Animated.Value(0.6)).current;
  const errorFade = useRef(new Animated.Value(0)).current;
  const headerFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Staggered entrance: logo first, then content
    Animated.sequence([
      Animated.parallel([
        Animated.spring(logoScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(headerFade, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(fadeIn, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(slideUp, {
          toValue: 0,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [fadeIn, slideUp, logoScale, headerFade]);

  // Animate error in/out
  useEffect(() => {
    Animated.timing(errorFade, {
      toValue: error ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [error, errorFade]);

  async function handlePress() {
    setError(null);
    setBusy(true);
    try {
      await onSignIn(email.trim(), password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
      {/* ---- Dark gradient overlay at top ---- */}
      <View
        style={[
          styles.topGradient,
          {
            backgroundColor: isDark
              ? "rgba(21,101,192,0.10)"
              : "rgba(21,101,192,0.05)",
          },
        ]}
      />
      {/* Subtle diagonal accent stripe */}
      <View
        style={[
          styles.accentStripe,
          {
            backgroundColor: isDark
              ? "rgba(21,101,192,0.06)"
              : "rgba(21,101,192,0.03)",
          },
        ]}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* ---- Branding ---- */}
          <Animated.View
            style={[
              styles.branding,
              { opacity: headerFade },
            ]}
          >
            <AppLogo scale={logoScale} />

            <View style={styles.appNameRow}>
              <Text style={[styles.appNameBrand, { color: colors.brand }]}>
                O3ON
              </Text>
              <Text style={[styles.appNameSub, { color: colors.textMuted }]}>
                Meeting Assistant
              </Text>
            </View>

            <View style={styles.taglineRow}>
              <Text style={[styles.taglinePart, { color: colors.textDim }]}>
                Snimaj
              </Text>
              <View
                style={[styles.taglineDot, { backgroundColor: colors.brand }]}
              />
              <Text style={[styles.taglinePart, { color: colors.textDim }]}>
                Transkribuj
              </Text>
              <View
                style={[styles.taglineDot, { backgroundColor: colors.brand }]}
              />
              <Text style={[styles.taglinePart, { color: colors.textDim }]}>
                Sumiraj
              </Text>
            </View>
          </Animated.View>

          {/* ---- Form card ---- */}
          <Animated.View
            style={[
              styles.card,
              {
                backgroundColor: colors.bgCard,
                borderColor: colors.border,
                opacity: fadeIn,
                transform: [{ translateY: slideUp }],
              },
              !isDark && {
                shadowColor: colors.shadow,
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 1,
                shadowRadius: 20,
                elevation: 6,
              },
            ]}
          >
            <Text style={[styles.cardHeading, { color: colors.text }]}>
              Prijava
            </Text>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.textMuted }]}>
                Email
              </Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="email@example.com"
                placeholderTextColor={colors.textDim}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.bgInput,
                    borderColor: colors.borderLight,
                    color: colors.text,
                  },
                ]}
                value={email}
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.textMuted }]}>
                Lozinka
              </Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="password"
                autoCorrect={false}
                onChangeText={setPassword}
                placeholder="********"
                placeholderTextColor={colors.textDim}
                secureTextEntry
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.bgInput,
                    borderColor: colors.borderLight,
                    color: colors.text,
                  },
                ]}
                value={password}
              />
            </View>

            {/* Error with animation */}
            <Animated.View
              style={[
                styles.errorBox,
                {
                  backgroundColor: colors.errorBg,
                  opacity: errorFade,
                  maxHeight: error ? 60 : 0,
                  overflow: "hidden",
                },
              ]}
            >
              <Text style={[styles.errorText, { color: colors.error }]}>
                {error}
              </Text>
            </Animated.View>

            <PrimaryButton
              disabled={busy || !email.trim() || !password}
              label={busy ? "Prijavljivanje..." : "Prijavi se"}
              onPress={handlePress}
              variant="brand"
            />

            {busy ? (
              <ActivityIndicator
                color={colors.brand}
                size="small"
                style={styles.spinner}
              />
            ) : null}
          </Animated.View>

          {/* ---- Footer ---- */}
          <Animated.View style={{ opacity: fadeIn }}>
            <Text style={[styles.footer, { color: colors.textDim }]}>
              Svi podaci se obrađuju na serveru. AI ključevi ne napuštaju
              backend.
            </Text>
            <Text style={[styles.version, { color: colors.textDim }]}>
              v0.1.0
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const LOGO_SIZE = 80;
const ORBIT_SIZE = 60;

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 48,
    gap: 36,
    maxWidth: 500,
    alignSelf: "center",
    width: "100%",
  },

  /* ---- Background decoration ---- */
  topGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 320,
    borderBottomLeftRadius: 80,
    borderBottomRightRadius: 80,
  },
  accentStripe: {
    position: "absolute",
    top: 60,
    right: -40,
    width: 200,
    height: 200,
    borderRadius: 100,
    transform: [{ scaleX: 2.5 }],
  },

  /* ---- Branding ---- */
  branding: {
    alignItems: "center",
    gap: 16,
  },

  /* ---- Logo ---- */
  logoOuter: {
    marginBottom: 4,
    alignItems: "center",
  },
  logoImage: {
    width: 100,
    height: 100,
  },

  /* ---- App name ---- */
  appNameRow: {
    alignItems: "center",
    gap: 2,
  },
  appNameBrand: {
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  appNameSub: {
    fontSize: 16,
    fontWeight: "500",
    letterSpacing: 0.5,
  },
  taglineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  taglinePart: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  taglineDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },

  /* ---- Card ---- */
  card: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 24,
    gap: 16,
  },
  cardHeading: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 2,
  },

  /* ---- Fields ---- */
  field: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },

  /* ---- Error ---- */
  errorBox: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
  },

  /* ---- Spinner ---- */
  spinner: {
    marginTop: -4,
  },

  /* ---- Footer ---- */
  footer: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  version: {
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 8,
    letterSpacing: 0.5,
  },
});
