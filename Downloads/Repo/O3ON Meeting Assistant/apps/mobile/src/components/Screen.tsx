import { ReactNode } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function Screen({ title, subtitle, children }: Props) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#07111F"
  },
  container: {
    padding: 20,
    gap: 18
  },
  header: {
    gap: 8,
    paddingTop: 10
  },
  title: {
    color: "#F8FAFC",
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -0.5
  },
  subtitle: {
    color: "#9CA3AF",
    fontSize: 15,
    lineHeight: 21
  }
});
