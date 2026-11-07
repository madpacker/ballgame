import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, ActivityIndicator, Platform, ImageBackground, RefreshControl, BackHandler, KeyboardAvoidingView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useEffect, useState, useCallback } from "react";
import * as Haptics from "expo-haptics";

import { radius, spacing } from "@/src/theme";
import { useAuth } from "@/src/contexts/auth";
import { api } from "@/src/api";
import { absoluteFileUrl } from "@/src/hooks/useAppSettings";

// Neon match-centre palette (fixed in every theme, like the lobby).
const N = { bg: "#04060F", white: "#FFFFFF", muted: "#9AA6C8", red: "#E3262F", glass: "rgba(16,22,44,0.85)", gold: "#FFC23A", green: "#2EE59D" };

// Fallback look for each league button until admin uploads a banner image.
const LEAGUE_STYLE: Record<string, { colors: [string, string]; glow: string }> = {
  super_league: { colors: ["#1240B8", "#0A1E5C"], glow: "#3D8BFF" },
  liga2: { colors: ["#0E8A4A", "#063D22"], glow: "#2EE59D" },
  laliga: { colors: ["#D4412C", "#1B2744"], glow: "#FF5A3C" },
  premier_league: { colors: ["#7A0A14", "#3A0408"], glow: "#FF3B4A" },
  serie_a: { colors: ["#4B2BC8", "#1A1260"], glow: "#8C6BFF" },
  others: { colors: ["#A0167A", "#3C0838"], glow: "#FF4FD8" },
};

type League = { key: string; name: string; banner_url?: string | null; upcoming: number };
type Match = {
  match_id: string;
  league?: string | null;
  home_team: string;
  away_team: string;
  home_logo?: string | null;
  away_logo?: string | null;
  stadium?: string | null;
  kickoff_at: string;
  final_home?: number | null;
  final_away?: number | null;
  status: "upcoming" | "live" | "finished";
  predict_open?: boolean;
  predict_close_at?: string | null;
};
type Prediction = { prediction_id: string; match_id: string; pred_home: number; pred_away: number; points?: number | null };
type LB = { user_id: string; name: string; picture?: string | null; total_points: number; predictions_count: number };

function TeamLogo({ uri, size = 52 }: { uri?: string | null; size?: number }) {
  if (!uri) {
    return (
      <View style={[styles.logoPh, { width: size, height: size, borderRadius: size / 2 }]}>
        <Ionicons name="shield" size={size * 0.55} color={N.muted} />
      </View>
    );
  }
  return <Image source={absoluteFileUrl(uri)} style={{ width: size, height: size }} contentFit="contain" />;
}

export default function MatchesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [tab, setTab] = useState<"list" | "leaderboard">("list");
  const [leagues, setLeagues] = useState<League[]>([]);
  const [league, setLeague] = useState<League | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [myPreds, setMyPreds] = useState<Record<string, Prediction>>({});
  const [lb, setLb] = useState<LB[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [homeInput, setHomeInput] = useState("");
  const [awayInput, setAwayInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadLeagues = useCallback(async () => {
    try {
      setLeagues(await api<League[]>("/leagues"));
    } catch {
      setLeagues([]);
    }
    api<LB[]>("/predictions/leaderboard?limit=50").then(setLb).catch(() => {});
  }, []);

  const loadMatches = useCallback(
    async (key: string) => {
      setLoading(true);
      try {
        setMatches(await api<Match[]>(`/matches?league=${key}`));
      } catch {
        setMatches([]);
      } finally {
        setLoading(false);
      }
      if (user) api<Record<string, Prediction>>("/me/predictions").then(setMyPreds).catch(() => {});
    },
    [user],
  );

  useEffect(() => {
    loadLeagues().finally(() => setLoading(false));
  }, [loadLeagues]);

  // Android back button: close the popup, then leave the league, then the screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (openId) {
        setOpenId(null);
        return true;
      }
      if (league) {
        setLeague(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [openId, league]);

  const openLeague = (lg: League) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setLeague(lg);
    loadMatches(lg.key);
  };

  const goBack = () => {
    if (league) return setLeague(null);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const openPredict = (m: Match) => {
    if (!user) return router.push("/login");
    const existing = myPreds[m.match_id];
    setHomeInput(existing ? String(existing.pred_home) : "");
    setAwayInput(existing ? String(existing.pred_away) : "");
    setErr(null);
    setOpenId(m.match_id);
  };

  const submitPredict = async () => {
    if (!openId) return;
    const h = parseInt(homeInput, 10);
    const a = parseInt(awayInput, 10);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) return;
    setSubmitting(true);
    try {
      await api(`/matches/${openId}/predict`, { method: "POST", body: JSON.stringify({ pred_home: h, pred_away: a }) });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOpenId(null);
      if (league) loadMatches(league.key);
    } catch {
      setErr("Prediksi sudah ditutup (30 menit sebelum kick-off) atau gagal dikirim.");
      if (league) loadMatches(league.key);
    } finally {
      setSubmitting(false);
    }
  };

  const openMatch = openId ? matches.find((m) => m.match_id === openId) ?? null : null;

  const renderLeagues = () => (
    <ScrollView
      contentContainerStyle={[styles.leagueList, { paddingBottom: insets.bottom + spacing.xl }]}
      refreshControl={<RefreshControl refreshing={false} onRefresh={loadLeagues} tintColor={N.white} />}
    >
      {leagues.map((lg) => {
        const st = LEAGUE_STYLE[lg.key] ?? LEAGUE_STYLE.others;
        return (
          <Pressable
            key={lg.key}
            testID={`league-${lg.key}`}
            onPress={() => openLeague(lg)}
            style={({ pressed }) => [styles.leagueBtn, { borderColor: st.glow, shadowColor: st.glow }, pressed && styles.pressed]}
          >
            {lg.banner_url ? (
              <Image source={absoluteFileUrl(lg.banner_url)} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <>
                <LinearGradient colors={st.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                <Text style={styles.leagueName}>{lg.name.toUpperCase()}</Text>
              </>
            )}
            {lg.upcoming > 0 && (
              <View style={styles.countPill}>
                <Text style={styles.countTxt}>{lg.upcoming} laga</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const renderMatches = () => (
    <ScrollView
      contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl, gap: spacing.md }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => league && loadMatches(league.key)} tintColor={N.white} />}
    >
      <Text style={styles.leagueTitle}>{league?.name.toUpperCase()}</Text>
      {loading ? (
        <ActivityIndicator color={N.white} style={{ marginTop: spacing.xl }} />
      ) : matches.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={56} color={N.muted} />
          <Text style={styles.emptyTitle}>Belum ada jadwal</Text>
          <Text style={styles.muted}>Admin akan menambah jadwal liga ini segera.</Text>
        </View>
      ) : (
        matches.map((m) => {
          const mp = myPreds[m.match_id];
          const ko = new Date(m.kickoff_at);
          return (
            <View key={m.match_id} testID={`match-${m.match_id}`} style={styles.matchCard}>
              <View style={styles.matchHeader}>
                <View style={[styles.statusPill, m.status === "live" && { backgroundColor: N.red }, m.status === "finished" && { backgroundColor: "#3A4260" }]}>
                  <Text style={styles.statusTxt}>{m.status === "live" ? "● LIVE" : m.status === "finished" ? "FINAL" : "AKAN DATANG"}</Text>
                </View>
                <Text style={styles.kickoff}>
                  {ko.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Jakarta" })} ·{" "}
                  {ko.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })} WIB
                </Text>
              </View>
              <View style={styles.matchBody}>
                <View style={styles.teamCol}>
                  <TeamLogo uri={m.home_logo} />
                  <Text numberOfLines={2} style={styles.teamName}>{m.home_team}</Text>
                </View>
                <Text style={styles.scoreTxt}>{m.status === "finished" ? `${m.final_home ?? "-"} – ${m.final_away ?? "-"}` : "VS"}</Text>
                <View style={styles.teamCol}>
                  <TeamLogo uri={m.away_logo} />
                  <Text numberOfLines={2} style={styles.teamName}>{m.away_team}</Text>
                </View>
              </View>
              {m.stadium ? (
                <View style={styles.stadiumRow}>
                  <Ionicons name="location" size={13} color={N.muted} />
                  <Text numberOfLines={1} style={styles.stadium}>{m.stadium}</Text>
                </View>
              ) : null}
              {mp ? (
                <View style={styles.predRow}>
                  <Ionicons name="checkmark-circle" size={16} color={N.green} />
                  <Text style={styles.predTxt}>
                    Prediksimu: <Text style={{ fontWeight: "900" }}>{mp.pred_home} – {mp.pred_away}</Text>
                    {mp.points != null && ` · ${mp.points > 0 ? "+" + mp.points : "0"} poin`}
                  </Text>
                  {m.predict_open && (
                    <Pressable testID={`edit-pred-${m.match_id}`} onPress={() => openPredict(m)} style={styles.editBtn}>
                      <Text style={styles.editTxt}>UBAH</Text>
                    </Pressable>
                  )}
                </View>
              ) : m.predict_open ? (
                <Pressable testID={`predict-${m.match_id}`} onPress={() => openPredict(m)} style={styles.predBtn}>
                  <Ionicons name="create" size={16} color={N.white} />
                  <Text style={styles.predBtnTxt}>PREDIKSI SKOR</Text>
                </Pressable>
              ) : (
                m.status === "upcoming" && (
                  <View testID={`pred-closed-${m.match_id}`} style={styles.closedPill}>
                    <Ionicons name="lock-closed" size={14} color={N.muted} />
                    <Text style={styles.closedTxt}>Prediksi ditutup 30 menit sebelum kick-off</Text>
                  </View>
                )
              )}
              {m.predict_open && m.predict_close_at ? (
                <Text style={styles.closeAt}>
                  Batas prediksi:{" "}
                  {new Date(m.predict_close_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })} WIB
                </Text>
              ) : null}
            </View>
          );
        })
      )}
    </ScrollView>
  );

  const renderBoard = () => (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
      {lb.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="podium-outline" size={56} color={N.muted} />
          <Text style={styles.emptyTitle}>Belum ada prediksi dinilai</Text>
          <Text style={styles.muted}>Poin dihitung setelah admin memasukkan hasil akhir.</Text>
        </View>
      ) : (
        lb.map((row, i) => (
          <View key={row.user_id} style={styles.lbRow}>
            <Text style={[styles.lbRank, i < 3 && { color: N.gold }]}>#{i + 1}</Text>
            {row.picture ? (
              <Image source={row.picture} style={styles.lbAvatar} />
            ) : (
              <View style={[styles.lbAvatar, { alignItems: "center", justifyContent: "center" }]}>
                <Ionicons name="person" size={18} color={N.white} />
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
  );

  return (
    <ImageBackground source={require("@/assets/bg/stadium.jpg")} style={styles.container} resizeMode="cover">
      <LinearGradient colors={["rgba(4,6,15,0.92)", "rgba(4,6,15,0.85)", "rgba(4,6,15,0.97)"]} style={StyleSheet.absoluteFill} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={goBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={30} color={N.white} />
        </Pressable>
        <Text style={styles.headerTitle}>PERTANDINGAN</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.tabs}>
        <Pressable testID="tab-list" onPress={() => setTab("list")} style={[styles.tab, tab === "list" && styles.tabActive]}>
          <Text style={[styles.tabTxt, tab === "list" && styles.tabTxtActive]}>Jadwal & Prediksi</Text>
        </Pressable>
        <Pressable testID="tab-leaderboard" onPress={() => setTab("leaderboard")} style={[styles.tab, tab === "leaderboard" && styles.tabActive]}>
          <Text style={[styles.tabTxt, tab === "leaderboard" && styles.tabTxtActive]}>Leaderboard</Text>
        </Pressable>
      </View>

      {tab === "leaderboard" ? renderBoard() : league ? renderMatches() : loading ? <ActivityIndicator color={N.white} style={{ marginTop: 60 }} /> : renderLeagues()}

      {openId && openMatch && (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.overlay}>
        <Pressable style={styles.overlayPress} onPress={() => setOpenId(null)} testID="predict-modal-overlay">
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.modal}>
            <Text style={styles.modalTitle}>PREDIKSI SKOR</Text>
            <View style={styles.scoreRow}>
              <View style={styles.scoreInputWrap}>
                <TeamLogo uri={openMatch.home_logo} size={44} />
                <TextInput
                  testID="pred-home"
                  keyboardType="number-pad"
                  value={homeInput}
                  onChangeText={(t) => setHomeInput(t.replace(/\D/g, ""))}
                  maxLength={2}
                  style={styles.scoreInput}
                  placeholder="0"
                  placeholderTextColor={N.muted}
                />
                <Text numberOfLines={1} style={styles.scoreInputLabel}>{openMatch.home_team}</Text>
              </View>
              <Text style={styles.scoreDash}>–</Text>
              <View style={styles.scoreInputWrap}>
                <TeamLogo uri={openMatch.away_logo} size={44} />
                <TextInput
                  testID="pred-away"
                  keyboardType="number-pad"
                  value={awayInput}
                  onChangeText={(t) => setAwayInput(t.replace(/\D/g, ""))}
                  maxLength={2}
                  style={styles.scoreInput}
                  placeholder="0"
                  placeholderTextColor={N.muted}
                />
                <Text numberOfLines={1} style={styles.scoreInputLabel}>{openMatch.away_team}</Text>
              </View>
            </View>
            <Text style={styles.hintTxt}>🎯 Tepat skor +300 · ⚽ Benar pemenang/seri +100</Text>
            {err && <Text style={styles.errTxt}>{err}</Text>}
            <Pressable
              testID="submit-pred"
              onPress={submitPredict}
              disabled={submitting || !homeInput || !awayInput}
              style={[styles.modalCta, (submitting || !homeInput || !awayInput) && { opacity: 0.5 }]}
            >
              {submitting ? <ActivityIndicator color={N.white} /> : <Text style={styles.modalCtaTxt}>KIRIM PREDIKSI</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      )}
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: N.bg },
  header: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, flexDirection: "row", alignItems: "center" },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: {
    flex: 1,
    color: N.white,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 3,
    textAlign: "center",
    textShadowColor: "#7FB2FF",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  tabs: {
    flexDirection: "row",
    marginHorizontal: spacing.md,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    padding: 4,
  },
  tab: { flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  tabActive: { backgroundColor: N.red, shadowColor: N.red, shadowOpacity: 0.8, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  tabTxt: { color: N.muted, fontWeight: "800", fontSize: 15 },
  tabTxtActive: { color: N.white },
  leagueList: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, gap: spacing.md },
  leagueBtn: {
    height: 92,
    borderRadius: radius.lg,
    borderWidth: 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  leagueName: {
    color: N.white,
    fontSize: 26,
    fontWeight: "900",
    fontStyle: "italic",
    letterSpacing: 0.5,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 4,
  },
  countPill: { position: "absolute", right: 8, bottom: 6, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  countTxt: { color: N.white, fontSize: 10, fontWeight: "800" },
  leagueTitle: { color: N.white, fontSize: 18, fontWeight: "900", fontStyle: "italic", letterSpacing: 1, textAlign: "center" },
  empty: { padding: spacing.xxxl, alignItems: "center", gap: spacing.sm },
  emptyTitle: { color: N.white, fontSize: 16, fontWeight: "800", marginTop: spacing.md },
  muted: { color: N.muted, fontSize: 13, textAlign: "center" },
  matchCard: { backgroundColor: N.glass, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", gap: spacing.sm },
  matchHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statusPill: { backgroundColor: "#13804F", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  statusTxt: { color: N.white, fontWeight: "900", fontSize: 10, letterSpacing: 1.2 },
  kickoff: { color: N.muted, fontSize: 11, fontWeight: "700" },
  matchBody: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  teamCol: { flex: 1, alignItems: "center", gap: 6 },
  teamName: { color: N.white, fontWeight: "800", fontSize: 13, textAlign: "center" },
  scoreTxt: { color: N.gold, fontWeight: "900", fontSize: 24, letterSpacing: 2, minWidth: 70, textAlign: "center" },
  logoPh: { backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  stadiumRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  stadium: { color: N.muted, fontSize: 11 },
  predRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.2)" },
  predTxt: { flex: 1, color: N.white, fontSize: 12 },
  editBtn: { minHeight: 36, paddingHorizontal: spacing.md, justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: N.gold },
  editTxt: { color: N.gold, fontWeight: "900", fontSize: 11, letterSpacing: 1 },
  predBtn: { backgroundColor: N.red, borderRadius: radius.md, minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  predBtnTxt: { color: N.white, fontWeight: "900", fontSize: 13, letterSpacing: 1.5 },
  closedPill: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.06)" },
  closedTxt: { color: N.muted, fontSize: 12, fontWeight: "700" },
  closeAt: { color: N.muted, fontSize: 11, textAlign: "center" },
  lbRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.15)" },
  lbRank: { color: N.muted, fontWeight: "900", fontSize: 14, width: 34 },
  lbAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#1B2347" },
  lbName: { color: N.white, fontSize: 14, fontWeight: "700" },
  lbSub: { color: N.muted, fontSize: 11, marginTop: 2 },
  lbPts: { color: N.gold, fontWeight: "900", fontSize: 18 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  overlayPress: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modal: { width: "100%", maxWidth: 380, backgroundColor: "#0C1230", borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1.5, borderColor: N.red },
  modalTitle: { color: N.white, fontWeight: "900", fontSize: 17, letterSpacing: 2, textAlign: "center" },
  scoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md },
  scoreInputWrap: { flex: 1, alignItems: "center", gap: 6 },
  scoreInput: {
    width: 78,
    height: 78,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: radius.md,
    color: N.white,
    fontSize: 36,
    fontWeight: "900",
    textAlign: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.3)",
  },
  scoreInputLabel: { color: N.muted, fontSize: 11, fontWeight: "700", maxWidth: 120 },
  scoreDash: { color: N.muted, fontSize: 32, fontWeight: "900" },
  hintTxt: { color: N.muted, fontSize: 12, textAlign: "center" },
  errTxt: { color: "#FF6B6B", fontSize: 12, textAlign: "center" },
  modalCta: { backgroundColor: N.red, minHeight: 50, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  modalCtaTxt: { color: N.white, fontWeight: "900", fontSize: 14, letterSpacing: 2 },
});
