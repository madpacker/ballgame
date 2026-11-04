import { View, Text, Pressable, StyleSheet, ScrollView, Platform, Share as RNShare } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState } from "react";
import * as Sharing from "expo-sharing";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";

import { colors, radius, spacing } from "@/src/theme";
import { BACKGROUNDS, CATEGORY_LABEL } from "@/src/data/quiz";
import { useAuth } from "@/src/contexts/auth";
import { api } from "@/src/api";
import { getLocalHigh, updateLocalHigh } from "@/src/storage/localHigh";
import { playTrumpet } from "@/src/hooks/useTrumpet";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function ResultScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    mode: "classic" | "time_attack" | "t_classic" | "t_time_attack";
    category: string;
    score: string;
    correct: string;
    total: string;
    challenge?: string;
    game_id?: string;
  }>();

  const score = parseInt(params.score || "0", 10) || 0;
  const correct = parseInt(params.correct || "0", 10) || 0;
  const total = Math.max(parseInt(params.total || "0", 10) || 0, correct);
  const mode = params.mode || "classic";
  const category = params.category || "all";
  const challengeId = params.challenge;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  const isTournament = mode === "t_classic" || mode === "t_time_attack";
  const modeLabel =
    mode === "t_classic"
      ? "Tournament Classic"
      : mode === "t_time_attack"
        ? "Tournament Time Attack"
        : mode === "classic"
          ? "Classic"
          : "Time Attack";
  const catLabel =
    category === "tournament"
      ? "Tournament"
      : CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL];

  const { user, refreshUser } = useAuth();
  const [personalHigh, setPersonalHigh] = useState(0);
  const [newRecord, setNewRecord] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [streakInfo, setStreakInfo] = useState<{ streak: number; bonus: number } | null>(null);
  const [challengeResult, setChallengeResult] = useState<{ beat: boolean; score_to_beat: number } | null>(null);
  const [createdChallenge, setCreatedChallenge] = useState<{ id: string; url: string } | null>(null);
  const [tInfo, setTInfo] = useState<{ board_score: number; rank: number | null; royal_awarded: number; new_best: boolean } | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [classicTotal, setClassicTotal] = useState<number | null>(null);

  useEffect(() => {
    // Crafted result URLs (no game ticket) must not touch the local record either.
    if (isTournament || (user && !params.game_id)) return;
    (async () => {
      const prev = (await getLocalHigh())[mode as "classic" | "time_attack"] ?? 0;
      const next = await updateLocalHigh(mode as "classic" | "time_attack", score);
      setPersonalHigh(next[mode as "classic" | "time_attack"]);
      const isRecord = score > prev && score > 0;
      setNewRecord(isRecord);
      if (isRecord) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        playTrumpet();
      }
    })();
  }, [mode, score]);

  useEffect(() => {
    if (!user || submitted || submitting) return;
    if (!params.game_id) {
      setSubmitErr("Skor sesi ini tidak bisa dikirim.");
      return;
    }
    setSubmitting(true);
    api<{
      ok: boolean;
      score: number;
      streak: number;
      streak_bonus: number;
      board_score?: number;
      rank?: number | null;
      royal_awarded?: number;
      new_best?: boolean;
      total_score?: number | null;
    }>("/scores", {
      method: "POST",
      body: JSON.stringify({ game_id: params.game_id, score, mode, category, correct, total }),
    })
      .then((r) => {
        setSubmitted(true);
        if (mode === "classic" && typeof r.total_score === "number") setClassicTotal(r.total_score);
        if (isTournament && r.board_score !== undefined) {
          setTInfo({
            board_score: r.board_score,
            rank: r.rank ?? null,
            royal_awarded: r.royal_awarded ?? 0,
            new_best: !!r.new_best,
          });
        }
        if (r.streak_bonus > 0) setStreakInfo({ streak: r.streak, bonus: r.streak_bonus });
        refreshUser().catch(() => {});
      })
      .catch((e) => {
        if (String(e).includes("tournament_closed")) setSubmitErr("Tournament sedang ditutup admin. Skor tidak dihitung.");
        else if (String(e).includes("409")) setSubmitErr("Skor sesi ini sudah tercatat sebelumnya.");
        else if (String(e).includes("game_too_fast")) setSubmitErr("Permainan terlalu cepat, skor tidak dihitung.");
        else setSubmitErr("Gagal mengirim skor. Periksa koneksi kamu.");
      })
      .finally(() => setSubmitting(false));
    if (challengeId) {
      api<{ beat: boolean; score_to_beat: number }>(`/challenges/${challengeId}/complete`, {
        method: "POST",
        body: JSON.stringify({ score }),
      })
        .then(setChallengeResult)
        .catch(() => {});
    }
  }, [user]);

  const share = async () => {
    const msg = `Saya skor ${score} di Cak Mad Quiz · ${isTournament ? modeLabel : catLabel} · ${accuracy}% akurasi. Kamu bisa lebih tinggi? #CakMadQuiz #MaduraUnited`;
    try {
      if (Platform.OS === "web") {
        if (navigator.share) {
          await navigator.share({ title: "Cak Mad Quiz", text: msg });
        } else {
          await navigator.clipboard.writeText(msg);
        }
        return;
      }
      await RNShare.share({ message: msg });
    } catch {}
  };

  const challengeFriend = async () => {
    if (!user) {
      router.push("/login");
      return;
    }
    try {
      const r = await api<{ challenge_id: string }>("/challenges/create", {
        method: "POST",
        body: JSON.stringify({ score, mode, category }),
      });
      const webUrl = `${BACKEND}/challenge/${r.challenge_id}`;
      const deepLink = `cakmad://challenge/${r.challenge_id}`;
      setCreatedChallenge({ id: r.challenge_id, url: webUrl });
      const msg = `⚔️ Aku menantangmu di Cak Mad Quiz!\nKalahkan skorku ${score} (${mode === "classic" ? "Classic" : "Time Attack"}).\n\n📱 Punya app: ${deepLink}\n🌐 Belum punya: ${webUrl}`;
      if (Platform.OS === "web") {
        if ((navigator as any).share) {
          await (navigator as any).share({ title: "Rematch Challenge", text: msg, url: webUrl });
        } else {
          await Clipboard.setStringAsync(msg);
        }
      } else {
        await RNShare.share({ message: msg });
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
          {newRecord || tInfo?.new_best ? "REKOR BARU!" : isTournament ? "HASIL TOURNAMENT" : "HASIL PERTANDINGAN"}
        </Text>
        <Text testID="final-score" style={styles.heroScore}>{score}</Text>
        <Text style={styles.heroSub}>
          {isTournament ? modeLabel : `${catLabel} · ${modeLabel}`}
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

        {isTournament && !tInfo && submitErr ? null : isTournament ? (
          <View testID="tournament-result-card" style={styles.highlightCard}>
            <View style={styles.highlightIcon}>
              <Ionicons name="trophy" size={22} color={colors.onBrandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.highlightLabel}>
                {mode === "t_classic" ? "TOTAL POIN KUMULATIF" : "HIGH SCORE TOURNAMENT"}
                {tInfo?.rank ? ` · PERINGKAT #${tInfo.rank}` : ""}
              </Text>
              <Text style={styles.highlightValue}>{tInfo ? tInfo.board_score : "-"}</Text>
              {!!tInfo?.royal_awarded && (
                <Text style={styles.royalTxt}>👑 +{tInfo.royal_awarded} poin Royal</Text>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.highlightCard}>
            <View style={styles.highlightIcon}>
              <Ionicons name="trophy" size={22} color={colors.onBrandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.highlightLabel}>SKOR TERTINGGI LOKAL · {modeLabel}</Text>
              <Text style={styles.highlightValue}>{personalHigh}</Text>
            </View>
          </View>
        )}

        {classicTotal !== null && (
          <View testID="classic-total-card" style={styles.highlightCard}>
            <View style={styles.highlightIcon}>
              <Ionicons name="podium" size={22} color={colors.onBrandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.highlightLabel}>TOTAL POIN CLASSIC (AKUMULASI)</Text>
              <Text testID="classic-total" style={styles.highlightValue}>{classicTotal}</Text>
              <Text style={styles.royalTxt}>+{score} dari sesi ini</Text>
            </View>
          </View>
        )}

        {submitErr && (
          <View testID="submit-error-card" style={[styles.statusCard, { borderColor: colors.error }]}>
            <Ionicons name="lock-closed" size={20} color={colors.error} />
            <Text style={styles.statusTxt}>{submitErr}</Text>
          </View>
        )}

        {user && !submitErr ? (
          <View testID="submit-status-card" style={styles.statusCard}>
            <Ionicons name="cloud-done" size={20} color={colors.success} />
            <Text style={styles.statusTxt}>
              {submitted ? "Skor berhasil dikirim ke leaderboard." : "Mengirim skor ke leaderboard..."}
            </Text>
          </View>
        ) : user ? null : (
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

        {challengeId && challengeResult && (
          <View style={[styles.statusCard, { borderColor: challengeResult.beat ? colors.success : colors.error, borderWidth: 1.5 }]}>
            <Ionicons
              name={challengeResult.beat ? "trophy" : "sad"}
              size={22}
              color={challengeResult.beat ? colors.brandSecondary : colors.error}
            />
            <Text style={styles.statusTxt}>
              {challengeResult.beat
                ? `Kamu KALAHKAN tantangan ${challengeResult.score_to_beat}! Notifikasi dikirim ke penantang.`
                : `Belum mengalahkan ${challengeResult.score_to_beat}. Coba lagi!`}
            </Text>
          </View>
        )}

        {createdChallenge && (
          <View style={styles.statusCard}>
            <Ionicons name="link" size={20} color={colors.brandSecondary} />
            <Text numberOfLines={1} style={styles.statusTxt}>Link rematch tersalin: {createdChallenge.url}</Text>
          </View>
        )}

        {streakInfo && (
          <View style={styles.streakCard}>
            <Text style={{ fontSize: 28 }}>🔥</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.streakTitle}>STREAK {streakInfo.streak} HARI</Text>
              <Text style={styles.streakSub}>Bonus +{streakInfo.bonus} poin otomatis masuk!</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        {isTournament ? (
          <Pressable
            testID="tournament-board-button"
            onPress={() => router.replace("/tournament/leaderboard")}
            style={styles.rematchBtn}
          >
            <Ionicons name="podium" size={16} color={colors.onBrandSecondary} />
            <Text numberOfLines={1} style={[styles.rematchTxt, { fontSize: 11, letterSpacing: 0.5 }]}>
              PERINGKAT
            </Text>
          </Pressable>
        ) : (
          <Pressable
            testID="rematch-button"
            onPress={challengeFriend}
            style={styles.rematchBtn}
          >
            <Ionicons name="flash" size={18} color={colors.onBrandSecondary} />
            <Text style={styles.rematchTxt}>TANTANG TEMAN</Text>
          </Pressable>
        )}
        <Pressable testID="share-button" onPress={share} style={styles.secondaryBtn}>
          <Ionicons name="share-social" size={18} color={colors.onSurface} />
        </Pressable>
        <Pressable
          testID="play-again-button"
          onPress={() => router.replace(isTournament ? "/tournament" : "/")}
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
  royalTxt: { color: colors.brandSecondary, fontWeight: "800", fontSize: 13, marginTop: 4 },
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
  streakCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    padding: spacing.md,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brandSecondary,
  },
  streakTitle: {
    color: colors.brandSecondary,
    fontWeight: "900",
    fontSize: 14,
    letterSpacing: 2,
  },
  streakSub: { color: colors.onBrandTertiary, fontSize: 12, marginTop: 2 },
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
    width: 56,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryTxt: { color: colors.onSurface, fontWeight: "700", fontSize: 14 },
  rematchBtn: {
    flex: 1,
    backgroundColor: colors.brandSecondary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm as number,
  },
  rematchTxt: { color: colors.onBrandSecondary, fontWeight: "900", fontSize: 13, letterSpacing: 1.5 },
});
