import { Pressable, Text, StyleSheet, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { colors, radius, spacing } from "@/src/theme";

/** Tappable list header that folds/unfolds a long admin list. */
export default function FoldHeader({
  title,
  count,
  open,
  onToggle,
  testID,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  testID?: string;
}) {
  return (
    <Pressable testID={testID} onPress={onToggle} style={[styles.bar, open && styles.barOpen]} accessibilityRole="button">
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
          {count != null ? ` · ${count}` : ""}
        </Text>
      </View>
      <Text style={styles.hint}>{open ? "Tutup" : "Buka"}</Text>
      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.onSurface} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  barOpen: { borderColor: colors.brandPrimary },
  title: { color: colors.onSurface, fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  hint: { color: colors.muted, fontSize: 11, fontWeight: "700" },
});
