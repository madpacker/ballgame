import { View, Text, Pressable, StyleSheet, ScrollView, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";
import * as Sharing from "expo-sharing";
import * as Haptics from "expo-haptics";

import { colors, radius, spacing } from "@/src/theme";
import { BACKGROUNDS, CATEGORY_LABEL } from "@/src/data/quiz";
import { useAuth } from "@/src/contexts/auth";
import { api } from "@/src/api";
import { getLocalHigh, updateLocalHigh } from "@/src/storage/localHigh";

export default function ResultScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    mode: "classic" | "time_attack";
    category: string;
    score: string;
    correct: string;
    total: string;
  }>();

  const score = parseInt(params.score || "0", 10) || 0;
  const correct = parseInt(params.correct || "0", 10) || 0;
  const total = Math.max(parseInt(params.total || "0", 10) || 0, correct);
  const mode = params.mode || "classic";
  const category = params.category || "all";
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

  const { user } = useAuth();
  const [personalHigh, setPersonalHigh] = useState(0);
  const [newRecord, setNewRecord] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const prev = (await getLocalHigh())[mode as "classic" | "time_attack"] ?? 0;
      const next = await updateLocalHigh(mode as "classic" | "time_attack", score);
      setPersonalHigh(next[mode as "classic" | "time_attack"]);
      setNewRecord(score > prev && score > 0);
      if (Platform.OS !== "web" && score > prev && score > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    })();
  }, [mode, score]);

  useEffect(() => {
    if (!user || submitted || submitting) return;
    setSubmitting(true);
    api("/scores", {
      method: "POST",
      body: JSON.stringify({ score, mode, category, correct, total }),
    })
      .then(() => setSubmitted(true))
      .catch(() => {})
      .finally(() => setSubmitting(false));
  }, [user]);

  const share = async () => {
    const msg = `Saya skor ${score} di Cak Mad Quiz · ${CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL]} · ${accuracy}% akurasi. Kamu bisa lebih tinggi? #CakMadQuiz #MaduraUnited`;
    try {
      if (Platform.OS === "web") {
        if (navigator.share) {
          await navigator.share({ title: "Cak Mad Quiz", text: msg });
        } else {
          await navigator.clipboard.writeText(msg);
        }
        return;
      }
      const available = await Sharing.isAvailableAsync();
      if (available) {
        // expo-sharing requires a file; fall back to clipboard-like message isn't supported.
        // Use Share API from react-native via dynamic import to avoid extra dep.
        const { Share } = await import("react-native");
        await Share.share({ message: msg });
      } else {
        const { Share } = await import("react-native");
        await Share.share({ message: msg });
      }
    } catch {}
  };

  return (
    <View style={styles.container}>
      <View style={[styles.hero, { paddingTop: insets.top + spacing.lg }]}>
        <Image source={BACKGROUNDS.trophy} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient
          colors={["rgba(15,17,21,0.5)", "rgba(15,17,21,0.9)", colors.surface]}
          style={StyleSheet.absoluteFill}
        />
        <Text style={styles.heroTag}>
          {newRecord ? "REKOR BARU!" : "HASIL PERTANDINGAN"}
        </Text>
        <Text testID="final-score" style={styles.heroScore}>{score}</Text>
        <Text style={styles.heroSub}>
          {CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL]} · {mode === "classic" ? "Classic" : "Time Attack"}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>BENAR</Text>
            <Text style={[styles.statValue, { color: colors.success }]}>{correct}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>SALAH</Text>
            <Text style={[styles.statValue, { color: colors.error }]}>{Math.max(total - correct, 0)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>AKURASI</Text>
            <Text style={[styles.statValue, { color: colors.brandSecondary }]}>{accuracy}%</Text>
          </View>
        </View>

        <View style={styles.highlightCard}>
          <View style={styles.highlightIcon}>
            <Ionicons name="trophy" size={22} color={colors.onBrandSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.highlightLabel}>SKOR TERTINGGI LOKAL · {mode === "classic" ? "Classic" : "Time Attack"}</Text>
            <Text style={styles.highlightValue}>{personalHigh}</Text>
          </View>
        </View>

        {user ? (
          <View style={styles.statusCard}>
            <Ionicons name="cloud-done" size={20} color={colors.success} />
            <Text style={styles.statusTxt}>
              {submitted ? "Skor berhasil dikirim ke leaderboard." : "Mengirim skor ke leaderboard..."}
            </Text>
          </View>
        ) : (
          <Pressable
            testID="login-leaderboard-cta"
            onPress={() => router.push("/login")}
            style={styles.statusCard}
          >
            <Ionicons name="log-in" size={20} color={colors.brandSecondary} />
            <Text style={styles.statusTxt}>Masuk untuk kirim skor ke leaderboard global.</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable testID="share-button" onPress={share} style={styles.secondaryBtn}>
          <Ionicons name="share-social" size={18} color={colors.onSurface} />
          <Text style={styles.secondaryTxt}>Bagikan</Text>
        </Pressable>
        <Pressable
          testID="play-again-button"
          onPress={() => router.replace("/")}
          style={styles.primaryBtn}
        >
          <Ionicons name="refresh" size={18} color={colors.onBrandPrimary} />
          <Text style={styles.primaryTxt}>MAIN LAGI</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  hero: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl,
    alignItems: "center",
    overflow: "hidden",
  },
  heroTag: {
    color: colors.brandSecondary,
    fontSize: 12,
    letterSpacing: 3,
    fontWeight: "800",
  },
  heroScore: {
    color: colors.onSurface,
    fontSize: 96,
    fontWeight: "900",
    letterSpacing: 4,
    marginTop: spacing.sm,
  },
  heroSub: { color: colors.muted, fontSize: 13, letterSpacing: 1, marginTop: 4 },
  body: { padding: spacing.lg, gap: spacing.md as number },
  statRow: { flexDirection: "row", gap: spacing.md as number },
  statCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  statLabel: { color: colors.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: "700" },
  statValue: { fontSize: 28, fontWeight: "900", marginTop: 4 },
  highlightCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    backgroundColor: colors.brandTertiary,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  highlightIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  highlightLabel: { color: colors.onBrandTertiary, fontSize: 11, letterSpacing: 1.5, fontWeight: "700" },
  highlightValue: { color: colors.brandSecondary, fontSize: 24, fontWeight: "900", marginTop: 2 },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusTxt: { flex: 1, color: colors.onSurface, fontSize: 13 },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    flexDirection: "row",
    gap: spacing.md as number,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  primaryBtn: {
    flex: 1.4,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm as number,
  },
  primaryTxt: {
    color: colors.onBrandPrimary,
    fontWeight: "900",
    fontSize: 15,
    letterSpacing: 2,
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm as number,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryTxt: { color: colors.onSurface, fontWeight: "700", fontSize: 14 },
});
