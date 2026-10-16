import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, ActivityIndicator, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState, useCallback } from "react";
import * as Haptics from "expo-haptics";

import { colors, radius, spacing } from "@/src/theme";
import { useAuth } from "@/src/contexts/auth";
import { api } from "@/src/api";
import { absolutePhotoUrl, type ApiPlayer } from "@/src/data/questions";

type Match = {
  match_id: string;
  opponent: string;
  kickoff_at: string;
  home: boolean;
  competition?: string | null;
  final_home?: number | null;
  final_away?: number | null;
  scorer_player_ids?: string[];
  motm_player_id?: string | null;
  status: "upcoming" | "live" | "finished";
};

type Prediction = {
  prediction_id: string;
  match_id: string;
  pred_home: number;
  pred_away: number;
  scorer_player_id?: string | null;
  scorer_name?: string | null;
  motm_player_id?: string | null;
  motm_name?: string | null;
  points?: number | null;
};

type LB = { user_id: string; name: string; picture?: string | null; total_points: number; predictions_count: number };

export default function MatchesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [tab, setTab] = useState<"list" | "leaderboard">("list");
  const [matches, setMatches] = useState<Match[]>([]);
  const [myPreds, setMyPreds] = useState<Record<string, Prediction | null>>({});
  const [lb, setLb] = useState<LB[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [homeInput, setHomeInput] = useState("");
  const [awayInput, setAwayInput] = useState("");
  const [scorerId, setScorerId] = useState<string | null>(null);
  const [motmId, setMotmId] = useState<string | null>(null);
  const [playerBank, setPlayerBank] = useState<ApiPlayer[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api<Match[]>("/matches");
      setMatches(list);
      if (user) {
        const preds: Record<string, Prediction | null> = {};
        await Promise.all(
          list.map(async (m) => {
            try {
              const r = await api<{ prediction: Prediction | null }>(`/me/prediction/${m.match_id}`);
              preds[m.match_id] = r.prediction;
            } catch {
              preds[m.match_id] = null;
            }
          }),
        );
        setMyPreds(preds);
      }
    } catch {
      setMatches([]);
    } finally {
      setLoading(false);
    }
    try {
      const l = await api<LB[]>("/predictions/leaderboard?limit=50");
      setLb(l);
    } catch {}
  }, [user]);

  useEffect(() => {
    refresh();
    api<ApiPlayer[]>("/players").then(setPlayerBank).catch(() => setPlayerBank([]));
  }, [refresh]);

  const openPredict = (m: Match) => {
    if (!user) {
      router.push("/login");
      return;
    }
    const existing = myPreds[m.match_id];
    setHomeInput(existing ? String(existing.pred_home) : "");
    setAwayInput(existing ? String(existing.pred_away) : "");
    setScorerId(existing?.scorer_player_id ?? null);
    setMotmId(existing?.motm_player_id ?? null);
    setOpenId(m.match_id);
  };

  const submitPredict = async () => {
    if (!openId) return;
    const h = parseInt(homeInput, 10);
    const a = parseInt(awayInput, 10);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) return;
    setSubmitting(true);
    try {
      await api(`/matches/${openId}/predict`, {
        method: "POST",
        body: JSON.stringify({
          pred_home: h,
          pred_away: a,
          scorer_player_id: scorerId,
          motm_player_id: motmId,
        }),
      });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOpenId(null);
      refresh();
    } catch {
    } finally {
      setSubmitting(false);
    }
  };

  const openMatch = openId ? matches.find((m) => m.match_id === openId) ?? null : null;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>PERTANDINGAN</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.tabs}>
        <Pressable
          testID="tab-list"
          onPress={() => setTab("list")}
          style={[styles.tab, tab === "list" && styles.tabActive]}
        >
          <Text style={[styles.tabTxt, tab === "list" && styles.tabTxtActive]}>Jadwal & Prediksi</Text>
        </Pressable>
        <Pressable
          testID="tab-leaderboard"
          onPress={() => setTab("leaderboard")}
          style={[styles.tab, tab === "leaderboard" && styles.tabActive]}
        >
          <Text style={[styles.tabTxt, tab === "leaderboard" && styles.tabTxtActive]}>Leaderboard</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : tab === "list" ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }}>
          {matches.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={56} color={colors.muted} />
              <Text style={styles.emptyTitle}>Belum ada jadwal</Text>
              <Text style={styles.muted}>Admin akan menambah jadwal pertandingan segera.</Text>
            </View>
          )}
          {matches.map((m) => {
            const mp = myPreds[m.match_id];
            const kickoff = new Date(m.kickoff_at);
            return (
              <View key={m.match_id} style={styles.matchCard}>
                <View style={styles.matchHeader}>
                  <View style={[styles.statusPill, m.status === "live" && { backgroundColor: colors.error }, m.status === "finished" && { backgroundColor: colors.muted }]}>
                    {m.status === "live" && <View style={styles.liveDot} />}
                    <Text style={styles.statusTxt}>
                      {m.status === "live" ? "LIVE" : m.status === "finished" ? "FINAL" : "AKAN DATANG"}
                    </Text>
                  </View>
                  <Text style={styles.matchComp}>{m.competition ?? "Liga 1"}</Text>
                </View>

                <View style={styles.matchBody}>
                  <View style={styles.teamCol}>
                    <Text style={styles.teamName}>{m.home ? "Madura United" : m.opponent}</Text>
                    <Text style={styles.teamTag}>{m.home ? "HOME" : "AWAY"}</Text>
                  </View>
                  <View style={styles.scoreCol}>
                    {m.status === "finished" ? (
                      <Text style={styles.scoreTxt}>{m.final_home} – {m.final_away}</Text>
                    ) : (
                      <Text style={styles.scoreTxt}>VS</Text>
                    )}
                    <Text style={styles.kickoff}>{kickoff.toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</Text>
                    <Text style={styles.kickoff}>{kickoff.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB</Text>
                  </View>
                  <View style={styles.teamCol}>
                    <Text style={styles.teamName}>{m.home ? m.opponent : "Madura United"}</Text>
                    <Text style={styles.teamTag}>{m.home ? "AWAY" : "HOME"}</Text>
                  </View>
                </View>

                {mp ? (
                  <View style={styles.predRow}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.predTxt}>
                        Prediksi: <Text style={{ fontWeight: "900" }}>{mp.pred_home} – {mp.pred_away}</Text>
                        {mp.points != null && ` · ${mp.points > 0 ? "+" + mp.points : "0"} poin`}
                      </Text>
                      {(mp.scorer_name || mp.motm_name) && (
                        <Text style={styles.predSubTxt}>
                          {mp.scorer_name ? `⚽ ${mp.scorer_name}` : ""}
                          {mp.scorer_name && mp.motm_name ? "  ·  " : ""}
                          {mp.motm_name ? `🏆 ${mp.motm_name}` : ""}
                        </Text>
                      )}
                    </View>
                    {m.status === "upcoming" && (
                      <Pressable onPress={() => openPredict(m)} hitSlop={6}>
                        <Text style={styles.editTxt}>Edit</Text>
                      </Pressable>
                    )}
                  </View>
                ) : (
                  m.status === "upcoming" && (
                    <Pressable testID={`predict-${m.match_id}`} onPress={() => openPredict(m)} style={styles.predBtn}>
                      <Ionicons name="create" size={16} color={colors.onBrandPrimary} />
                      <Text style={styles.predBtnTxt}>PREDIKSI SKOR</Text>
                    </Pressable>
                  )
                )}
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
          {lb.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="podium-outline" size={56} color={colors.muted} />
              <Text style={styles.emptyTitle}>Belum ada prediksi dinilai</Text>
              <Text style={styles.muted}>Admin perlu memasukkan hasil akhir supaya poin dihitung.</Text>
            </View>
          ) : (
            lb.map((row, i) => (
              <View key={row.user_id} style={styles.lbRow}>
                <Text style={styles.lbRank}>#{i + 1}</Text>
                {row.picture ? (
                  <Image source={row.picture} style={styles.lbAvatar} />
                ) : (
                  <View style={[styles.lbAvatar, { alignItems: "center", justifyContent: "center" }]}>
                    <Ionicons name="person" size={18} color={colors.onSurface} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbName}>{row.name}</Text>
                  <Text style={styles.lbSub}>{row.predictions_count} prediksi</Text>
                </View>
                <Text style={styles.lbPts}>{row.total_points}</Text>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {openId && openMatch && (
        <Pressable
          style={styles.overlay}
          onPress={() => setOpenId(null)}
          testID="predict-modal-overlay"
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.modal}>
            <Text style={styles.modalTitle}>PREDIKSI SKOR</Text>
            <Text style={styles.modalSub}>
              {openMatch.home ? "Madura United" : openMatch.opponent} vs {openMatch.home ? openMatch.opponent : "Madura United"}
            </Text>
            <View style={styles.scoreRow}>
              <View style={styles.scoreInputWrap}>
                <TextInput
                  testID="pred-home"
                  keyboardType="number-pad"
                  value={homeInput}
                  onChangeText={setHomeInput}
                  maxLength={2}
                  style={styles.scoreInput}
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                />
                <Text style={styles.scoreInputLabel}>{openMatch.home ? "MU" : "LAWAN"}</Text>
              </View>
              <Text style={styles.scoreDash}>–</Text>
              <View style={styles.scoreInputWrap}>
                <TextInput
                  testID="pred-away"
                  keyboardType="number-pad"
                  value={awayInput}
                  onChangeText={setAwayInput}
                  maxLength={2}
                  style={styles.scoreInput}
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                />
                <Text style={styles.scoreInputLabel}>{openMatch.home ? "LAWAN" : "MU"}</Text>
              </View>
            </View>
            <View style={styles.hintCard}>
              <Text style={styles.hintTxt}>🎯 Tepat skor +300 · ⚽ Benar pemenang +100 · 🥅 Pencetak gol +150 · 🏆 MOTM +200</Text>
            </View>

            <Text style={styles.pickerLabel}>⚽ TEBAK PENCETAK GOL (opsional)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
              <Pressable
                testID="scorer-none"
                onPress={() => setScorerId(null)}
                style={[styles.pickerChip, !scorerId && styles.pickerChipActive]}
              >
                <Text style={styles.pickerChipTxt}>Tidak pilih</Text>
              </Pressable>
              {playerBank.map((p) => (
                <Pressable
                  key={p.player_id}
                  testID={`scorer-${p.player_id}`}
                  onPress={() => setScorerId(p.player_id)}
                  style={[styles.pickerChip, scorerId === p.player_id && styles.pickerChipActive]}
                >
                  <Text style={styles.pickerChipTxt}>{p.name}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.pickerLabel}>🏆 TEBAK MAN OF THE MATCH (opsional)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
              <Pressable
                testID="motm-none"
                onPress={() => setMotmId(null)}
                style={[styles.pickerChip, !motmId && styles.pickerChipActive]}
              >
                <Text style={styles.pickerChipTxt}>Tidak pilih</Text>
              </Pressable>
              {playerBank.map((p) => (
                <Pressable
                  key={p.player_id}
                  testID={`motm-${p.player_id}`}
                  onPress={() => setMotmId(p.player_id)}
                  style={[styles.pickerChip, motmId === p.player_id && styles.pickerChipActive]}
                >
                  <Text style={styles.pickerChipTxt}>{p.name}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Pressable
              testID="submit-pred"
              onPress={submitPredict}
              disabled={submitting || !homeInput || !awayInput}
              style={[styles.modalCta, (submitting || !homeInput || !awayInput) && { opacity: 0.5 }]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <Text style={styles.modalCtaTxt}>KIRIM PREDIKSI</Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm as number,
  },
  backBtn: { padding: spacing.xs },
  headerTitle: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: 2, textAlign: "center" },
  tabs: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: 4,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: "center" },
  tabActive: { backgroundColor: colors.brandPrimary },
  tabTxt: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  tabTxtActive: { color: colors.onBrandPrimary },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { padding: spacing.xxxl, alignItems: "center", gap: spacing.sm as number },
  emptyTitle: { color: colors.onSurface, fontSize: 16, fontWeight: "800", marginTop: spacing.md },
  muted: { color: colors.muted, fontSize: 13, textAlign: "center" },
  matchCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md as number,
  },
  matchHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.success,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.onBrandPrimary },
  statusTxt: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 10, letterSpacing: 1.5 },
  matchComp: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  matchBody: { flexDirection: "row", alignItems: "center", gap: spacing.sm as number },
  teamCol: { flex: 1, alignItems: "center", gap: 4 },
  teamName: { color: colors.onSurface, fontWeight: "800", fontSize: 13, textAlign: "center" },
  teamTag: { color: colors.muted, fontSize: 10, letterSpacing: 1 },
  scoreCol: { alignItems: "center", gap: 2 },
  scoreTxt: { color: colors.brandSecondary, fontWeight: "900", fontSize: 20, letterSpacing: 2 },
  kickoff: { color: colors.muted, fontSize: 11 },
  predRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm as number,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  predTxt: { color: colors.onSurface, fontSize: 12 },
  predSubTxt: { color: colors.muted, fontSize: 11, marginTop: 2 },
  pickerLabel: {
    color: colors.muted,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: "800",
    marginTop: spacing.sm,
  },
  pickerRow: { paddingVertical: spacing.xs, gap: spacing.sm as number },
  pickerChip: {
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerChipActive: { borderColor: colors.brandSecondary, backgroundColor: colors.brandTertiary },
  pickerChipTxt: { color: colors.onSurface, fontSize: 12, fontWeight: "700" },
  editTxt: { color: colors.brandSecondary, fontWeight: "900", fontSize: 11, letterSpacing: 1 },
  predBtn: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm as number,
  },
  predBtnTxt: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 12, letterSpacing: 1.5 },
  lbRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  lbRank: { color: colors.muted, fontWeight: "900", fontSize: 14, width: 32 },
  lbAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceSecondary },
  lbName: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  lbSub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  lbPts: { color: colors.brandSecondary, fontWeight: "900", fontSize: 18 },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modal: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md as number,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  modalTitle: { color: colors.onSurface, fontWeight: "900", fontSize: 16, letterSpacing: 2, textAlign: "center" },
  modalSub: { color: colors.muted, fontSize: 12, textAlign: "center" },
  scoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md as number },
  scoreInputWrap: { alignItems: "center", gap: 4 },
  scoreInput: {
    width: 80,
    height: 80,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    color: colors.onSurface,
    fontSize: 36,
    fontWeight: "900",
    textAlign: "center",
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  scoreInputLabel: { color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  scoreDash: { color: colors.muted, fontSize: 32, fontWeight: "900" },
  hintCard: { backgroundColor: colors.brandTertiary, padding: spacing.sm, borderRadius: radius.sm },
  hintTxt: { color: colors.onBrandTertiary, fontSize: 11, textAlign: "center" },
  modalCta: {
    backgroundColor: colors.brandPrimary,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
  },
  modalCtaTxt: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 13, letterSpacing: 2 },
});
