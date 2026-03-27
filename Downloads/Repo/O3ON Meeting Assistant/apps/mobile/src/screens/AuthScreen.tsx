import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { PrimaryButton } from "../components/PrimaryButton";

type Props = {
  onSignIn: (email: string, password: string) => Promise<void>;
  busy?: boolean;
};

export function AuthScreen({ onSignIn, busy }: Props) {
  const [email, setEmail] = useState("sasa@example.com");
  const [password, setPassword] = useState("meeting-assistant");
  const [error, setError] = useState<string | null>(null);

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>Secure meeting intelligence</Text>
        <Text style={styles.title}>Capture, transcribe, summarize, assign actions.</Text>
        <Text style={styles.body}>
          Token-backed login, encrypted session storage, and a backend-first AI pipeline for Serbian meetings.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Email</Text>
        <TextInput autoCapitalize="none" autoComplete="email" autoCorrect={false} onChangeText={setEmail} style={styles.input} value={email} />
        <Text style={styles.label}>Password</Text>
        <TextInput autoCapitalize="none" autoComplete="password" autoCorrect={false} onChangeText={setPassword} secureTextEntry style={styles.input} value={password} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton
          disabled={busy}
          label={busy ? "Signing in..." : "Sign in"}
          onPress={async () => {
            setError(null);
            try {
              await onSignIn(email.trim(), password);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Sign-in failed");
            }
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    gap: 24
  },
  hero: {
    gap: 12
  },
  kicker: {
    color: "#E2B714",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  title: {
    color: "#F8FAFC",
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "800"
  },
  body: {
    color: "#9CA3AF",
    fontSize: 16,
    lineHeight: 24
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 24,
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    gap: 12,
    padding: 18
  },
  label: {
    color: "#CBD5E1",
    fontSize: 13,
    fontWeight: "700"
  },
  input: {
    backgroundColor: "#0B1728",
    borderColor: "rgba(148,163,184,0.25)",
    borderRadius: 14,
    borderWidth: 1,
    color: "#F8FAFC",
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  error: {
    color: "#FCA5A5",
    fontSize: 13
  }
});
