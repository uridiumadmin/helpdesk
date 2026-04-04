import { Pressable, StyleSheet, Text, ViewStyle } from "react-native";
import { useTheme } from "../theme/ThemeContext";

type Props = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "brand" | "accent" | "secondary" | "ghost" | "danger";
  style?: ViewStyle;
  disabled?: boolean;
};

export function PrimaryButton({
  label,
  onPress,
  variant = "primary",
  style,
  disabled,
}: Props) {
  const { colors, isDark } = useTheme();

  function getBackgroundColor(): string {
    switch (variant) {
      case "primary":
        return colors.brand;
      case "brand":
        return colors.brand;
      case "accent":
        return colors.accent;
      case "danger":
        return colors.error;
      case "secondary":
        return isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
      case "ghost":
        return "transparent";
      default:
        return colors.brand;
    }
  }

  function getBorderColor(): string {
    switch (variant) {
      case "secondary":
        return colors.border;
      default:
        return "transparent";
    }
  }

  function getLabelColor(): string {
    switch (variant) {
      case "primary":
        return "#FFFFFF";
      case "brand":
        return "#FFFFFF";
      case "accent":
        return "#FFFFFF";
      case "danger":
        return "#FFFFFF";
      case "secondary":
        return colors.text;
      case "ghost":
        return colors.textMuted;
      default:
        return "#FFFFFF";
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: getBackgroundColor(),
          borderColor: getBorderColor(),
          borderWidth: variant === "secondary" ? 1 : 0,
        },
        !isDark && {
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 1,
          shadowRadius: 4,
          elevation: 3,
        },
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.label, { color: getLabelColor() }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  label: {
    fontSize: 16,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.5,
  },
});
