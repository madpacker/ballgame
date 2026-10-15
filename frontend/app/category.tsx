import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { useSkin } from "@/src/contexts/skin";
import { CATEGORY_DESC, CATEGORY_LABEL, type Category } from "@/src/data/quiz";

type CatKey = Category | "all";

const CATS: { key: CatKey; icon: any; color: string }[] = [
  { key: "all", icon: "shuffle", color: colors.brandPrimary },
  { key: "guess", icon: "person-circle", color: colors.brandSecondary },
  { key: "history", icon: "book", color: colors.info },
  { key: "trivia", icon: "football", color: colors.success },
];

export default function CategoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode: "classic" | "time_attack" }>();
  const [selected, setSelected] = useState<CatKey>("all");
  const { accent } = useSkin();

  const start = () => {
    router.replace({
      pathname: "/quiz",
      params: { mode: mode ?? "classic", category: selected },
    });
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTag}>MODE</Text>
          <Text style={styles.headerTitle}>
            {mode === "time_attack" ? "TIME ATTACK · 60s" : "CLASSIC · 10 SOAL"}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionTitle}>PILIH KATEGORI</Text>

        <View style={styles.grid}>
          {CATS.map((c) => {
            const active = selected === c.key;
            return (
              <Pressable
                key={c.key}
                testID={`category-${c.key}`}
                onPress={() => setSelected(c.key)}
                style={[
                  styles.card,
                  active && { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
                ]}
              >
                <View style={[styles.catIcon, { backgroundColor: c.color }]}>
                  <Ionicons name={c.icon} size={28} color={colors.onBrand} />
                </View>
                <Text style={styles.catTitle}>{CATEGORY_LABEL[c.key]}</Text>
                <Text style={styles.catDesc}>{CATEGORY_DESC[c.key]}</Text>
                {active && (
                  <View style={styles.checkBadge}>
                    <Ionicons name="checkmark" size={14} color={colors.onBrandPrimary} />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          testID="start-match-button"
          onPress={start}
          style={({ pressed }) => [styles.cta, { backgroundColor: accent.primary }, pressed && { opacity: 0.85 }]}
        >
          <Text style={[styles.ctaText, { color: accent.onPrimary }]}>MULAI PERTANDINGAN</Text>
          <Ionicons name="play" size={20} color={accent.onPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm as number,
  },
  backBtn: { padding: spacing.xs },
  headerTag: { color: colors.muted, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  headerTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  content: { padding: spacing.lg },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: "800",
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md as number,
  },
  card: {
    width: "47.5%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    minHeight: 160,
  },
  catIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  catTitle: {
    color: colors.onSurface,
    fontWeight: "900",
    fontSize: 15,
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  catDesc: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  checkBadge: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cta: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm as number,
  },
  ctaText: {
    color: colors.onBrandPrimary,
    fontWeight: "900",
    fontSize: 16,
    letterSpacing: 2,
  },
});
