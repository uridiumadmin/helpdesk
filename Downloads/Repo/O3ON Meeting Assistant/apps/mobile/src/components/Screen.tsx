import { ReactNode, useEffect, useRef } from "react";
import {
  Animated,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

/** Approximate status-bar height for notch / Dynamic Island devices on iOS */
const IOS_STATUS_BAR_HEIGHT = 44;
/** Standard Android status bar height fallback */
const ANDROID_STATUS_BAR_HEIGHT = StatusBar.currentHeight ?? 24;

/**
 * Extra top padding so content doesn't tuck behind the notch / status bar.
 * SafeAreaView handles this on iOS, but on Android and web we add it manually.
 */
function getStatusBarPadding(): number {
  if (Platform.OS === "android") {
    return ANDROID_STATUS_BAR_HEIGHT;
  }
  if (Platform.OS === "web") {
    // PWA standalone mode on iOS doesn't get SafeAreaView — add manual padding
    return IOS_STATUS_BAR_HEIGHT;
  }
  // iOS native — SafeAreaView handles it
  return 0;
}

export function Screen({ title, subtitle, children }: Props) {
  const { colors, isDark } = useTheme();
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, [fadeIn]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        backgroundColor={colors.bg}
        translucent={Platform.OS === "android"}
      />
      <Animated.View style={[styles.flex, { opacity: fadeIn }]}>
        <ScrollView
          contentContainerStyle={[
            styles.container,
            { paddingTop: styles.container.paddingTop + getStatusBarPadding() },
          ]}
        >
          <View style={styles.inner}>
            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.text }]}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={[styles.subtitle, { color: colors.textMuted }]}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {children}
          </View>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
    gap: 18,
    /**
     * On tablets / desktop browsers, center the content and cap width so the
     * app doesn't stretch uncomfortably wide.
     */
    alignSelf: "center",
    width: "100%",
    maxWidth: 500,
  },
  inner: {
    flex: 1,
    gap: 18,
  },
  header: {
    gap: 8,
    paddingTop: 6,
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
  },
});
