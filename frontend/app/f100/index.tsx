import { View, Text, Pressable, StyleSheet, ScrollView, ImageBackground, ActivityIndicator, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";

import { spacing, radius } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/contexts/auth";

// Fixed lobby palette (identical in every theme).
const C = { white: "#FFFFFF", gold: "#F2C24E", cyan: "#3FD0FF", glass: "rgba(10,22,52,0.85)", muted: "#AEB9D6", red: "#E5484D", green: "#3FCF8E", slot: "rgba(255,255,255,0.08)" };

type Q = { item_id: string; prompt: string; options: string[] };
type Ans = { item_id: string; picks: string[]; time_ms: number };
type Result = { score: number; hits: number; slots: number; perfect: number; time_ms: number; total_score: number; rank: number; results: { item_id: string; points: number; key: string[] }[] };

const fmtTime = (ms: number) => {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function Football100() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [gameId, setGameId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(30);
  const [qs, setQs] = useState<Q[]>([]);
  const [idx, setIdx] = useState(0);
  const [picks, setPicks] = useState<string[]>([]);
  const [left, setLeft] = useState(30);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const answers = useRef<Ans[]>([]);
  const startedAt = useRef(Date.now());
  const locked = useRef(false);

  const start = useCallback(async () => {
    setErr(null);
    setResult(null);
    setQs([]);
    answers.current = [];
    try {
      const r = await api<{ game_id: string; seconds: number; questions: Q[] }>("/f100/start", { method: "POST" });
      setGameId(r.game_id);
      setSeconds(r.seconds);
      setQs(r.questions);
      setIdx(0);
      setPicks([]);
      setLeft(r.seconds);
      startedAt.current = Date.now();
      locked.current = false;
    } catch (e) {
      setErr(String(e).includes("no_questions") ? "Belum ada soal Football 100. Admin akan segera menambahkannya!" : "Gagal memuat soal.");
    }
  }, []);

  useEffect(() => {
    if (user) start();
  }, [user, start]);

  const submitAll = useCallback(async () => {
    if (!gameId) return;
    setSubmitting(true);
    try {
      setResult(await api<Result>("/f100/submit", { method: "POST", body: JSON.stringify({ game_id: gameId, answers: answers.current }) }));
    } catch {
      setErr("Gagal mengirim jawaban.");
    }
    setSubmitting(false);
  }, [gameId]);

  const next = useCallback(
    (finalPicks: string[]) => {
      if (locked.current || !qs[idx]) return;
      locked.current = true;
      answers.current.push({ item_id: qs[idx].item_id, picks: finalPicks, time_ms: Math.min(seconds * 1000, Date.now() - startedAt.current) });
      setTimeout(() => {
        if (idx + 1 >= qs.length) {
          submitAll();
        } else {
          setIdx(idx + 1);
          setPicks([]);
          setLeft(seconds);
          startedAt.current = Date.now();
          locked.current = false;
        }
      }, 450);
    },
    [qs, idx, seconds, submitAll],
  );

  // 30s per question; time-out locks whatever was picked.
  const picksRef = useRef(picks);
  picksRef.current = picks;
  useEffect(() => {
    if (!qs.length || result) return;
    const id = setInterval(() => {
      setLeft((t) => {
        if (t <= 1) {
          clearInterval(id);
          setTimeout(() => next(picksRef.current), 0);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [idx, qs.length, result, next]);

  const tapOption = (o: string) => {
    if (locked.current || picks.includes(o) || picks.length >= 4) return;
    if (Platform.OS !== "web") Haptics.selectionAsync();
    const np = [...picks, o];
    setPicks(np);
    if (np.length === 4) next(np);
  };
  const tapSlot = (i: number) => {
    if (locked.current || !picks[i]) return;
    setPicks(picks.filter((_, j) => j !== i));
  };

  const q = qs[idx];

  return (
    <ImageBackground source={require("@/assets/bg/stadium.jpg")} style={styles.container} resizeMode="cover">
      <LinearGradient colors={["rgba(10,40,110,0.55)", "rgba(7,22,55,0.88)", "rgba(7,22,55,0.98)"]} style={StyleSheet.absoluteFill} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} style={styles.sqBtn}>
          <Ionicons name="chevron-back" size={26} color={C.white} />
        </Pressable>
        <Text style={styles.title}>
          FOOTBALL <Text style={{ color: C.gold }}>100</Text>
        </Text>
        <Pressable testID="f100-board-button" onPress={() => router.push("/f100/leaderboard")} style={styles.sqBtn}>
          <Ionicons name="podium" size={22} color={C.gold} />
        </Pressable>
      </View>

      {!user ? (
        <View style={styles.center}>
          <Text style={styles.info}>Masuk dulu untuk main Football 100.</Text>
          <Pressable testID="f100-login" onPress={() => router.push("/login")} style={styles.cta}>
            <Text style={styles.ctaTxt}>MASUK</Text>
          </Pressable>
        </View>
      ) : err ? (
        <View style={styles.center}>
          <Ionicons name="football" size={56} color={C.gold} />
          <Text testID="f100-error" style={styles.info}>{err}</Text>
          <Pressable onPress={start} style={styles.cta}>
            <Text style={styles.ctaTxt}>COBA LAGI</Text>
          </Pressable>
        </View>
      ) : submitting || (!q && !result) ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.gold} size="large" />
        </View>
      ) : result ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View testID="f100-result" style={styles.resultCard}>
            <Text style={styles.resLbl}>SKOR SESI INI</Text>
            <Text testID="f100-score" style={styles.resScore}>{result.score}</Text>
            <Text style={styles.resSub}>
              Total akumulasi {result.total_score} · Peringkat #{result.rank}
            </Text>
            <View style={styles.resRow}>
              <Stat label="AKURASI" value={`${result.slots ? Math.round((1000 * result.hits) / result.slots) / 10 : 0}%`} />
              <Stat label="SEMPURNA" value={`${result.perfect}/${qs.length}`} />
              <Stat label="WAKTU" value={fmtTime(result.time_ms)} />
            </View>
          </View>
          {result.results.map((r, i) => (
            <View key={r.item_id} style={styles.review}>
              <Text style={styles.reviewQ} numberOfLines={2}>{i + 1}. {qs.find((x) => x.item_id === r.item_id)?.prompt}</Text>
              <Text style={styles.reviewKey}>{r.key.join(" → ")}</Text>
              <Text style={[styles.reviewPts, { color: r.points === 100 ? C.green : r.points ? C.gold : C.red }]}>+{r.points}</Text>
            </View>
          ))}
          <View style={styles.resBtns}>
            <Pressable testID="f100-again" onPress={start} style={[styles.cta, { flex: 1 }]}>
              <Text style={styles.ctaTxt}>MAIN LAGI</Text>
            </Pressable>
            <Pressable testID="f100-result-board" onPress={() => router.push("/f100/leaderboard")} style={[styles.cta, styles.ctaGhost, { flex: 1 }]}>
              <Text style={styles.ctaTxt}>PERINGKAT</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.topRow}>
            <Text testID="f100-progress" style={styles.progress}>SOAL {idx + 1}/{qs.length}</Text>
            <View style={[styles.timer, left <= 10 && { borderColor: C.red }]}>
              <Ionicons name="timer" size={16} color={left <= 10 ? C.red : C.cyan} />
              <Text testID="f100-timer" style={[styles.timerTxt, left <= 10 && { color: C.red }]}>{left}s</Text>
            </View>
          </View>
          <View style={styles.timeTrack}>
            <View style={[styles.timeFill, { width: `${(left / seconds) * 100}%` }, left <= 10 && { backgroundColor: C.red }]} />
          </View>

          <View style={styles.slots}>
            {[0, 1, 2, 3].map((i) => (
              <Pressable key={i} testID={`f100-slot-${i}`} onPress={() => tapSlot(i)} style={[styles.slot, picks[i] && styles.slotFilled]}>
                <View style={styles.slotNum}>
                  <Text style={styles.slotNumTxt}>{i + 1}</Text>
                </View>
                <Text numberOfLines={1} style={styles.slotTxt}>{picks[i] ?? ""}</Text>
                {picks[i] && <Ionicons name="close-circle" size={18} color={C.muted} />}
              </Pressable>
            ))}
          </View>

          <View style={styles.qCard}>
            <Text testID="f100-question" style={styles.qTxt}>{q!.prompt}</Text>
          </View>

          <View style={styles.options}>
            {q!.options.map((o, i) => {
              const used = picks.includes(o);
              return (
                <Pressable key={o} testID={`f100-option-${i}`} disabled={used} onPress={() => tapOption(o)} style={[styles.opt, used && { opacity: 0.3 }]}>
                  <Text numberOfLines={2} style={styles.optTxt}>{o}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>Benar semua & urut = 100 poin · jawaban benar tapi posisi salah = 10 poin</Text>
        </ScrollView>
      )}
    </ImageBackground>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLbl}>{label}</Text>
      <Text style={styles.statVal}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#071637" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  sqBtn: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: C.glass, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  title: { color: C.white, fontSize: 28, fontWeight: "900", fontStyle: "italic", textShadowColor: "#5FB4FF", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
  info: { color: C.white, fontSize: 15, textAlign: "center", lineHeight: 21 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progress: { color: C.gold, fontWeight: "900", fontSize: 14, letterSpacing: 1 },
  timer: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1.5, borderColor: C.cyan, backgroundColor: C.glass },
  timerTxt: { color: C.white, fontWeight: "900", fontSize: 15 },
  timeTrack: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.12)", overflow: "hidden" },
  timeFill: { height: "100%", backgroundColor: C.cyan },
  slots: { gap: spacing.sm },
  slot: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: "rgba(242,194,78,0.45)", borderStyle: "dashed", backgroundColor: C.slot, paddingHorizontal: spacing.sm },
  slotFilled: { borderStyle: "solid", borderColor: C.gold, backgroundColor: "rgba(242,194,78,0.16)" },
  slotNum: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.gold, alignItems: "center", justifyContent: "center" },
  slotNumTxt: { color: "#3A2600", fontWeight: "900" },
  slotTxt: { flex: 1, color: C.white, fontWeight: "800", fontSize: 15 },
  qCard: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: C.glass, borderWidth: 1.5, borderColor: C.cyan, shadowColor: C.cyan, shadowOpacity: 0.6, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
  qTxt: { color: C.white, fontSize: 17, fontWeight: "800", textAlign: "center", lineHeight: 23 },
  options: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing.sm },
  opt: { width: "48.5%", minHeight: 56, borderRadius: radius.md, backgroundColor: "#16306A", borderWidth: 1.5, borderColor: "rgba(95,180,255,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.sm },
  optTxt: { color: C.white, fontWeight: "800", fontSize: 14, textAlign: "center" },
  hint: { color: C.muted, fontSize: 11, textAlign: "center" },
  cta: { backgroundColor: "#D7262E", borderRadius: radius.md, borderWidth: 1.5, borderColor: C.gold, minHeight: 52, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  ctaGhost: { backgroundColor: C.glass },
  ctaTxt: { color: C.white, fontWeight: "900", fontSize: 16, fontStyle: "italic" },
  resultCard: { alignItems: "center", padding: spacing.lg, borderRadius: radius.lg, backgroundColor: C.glass, borderWidth: 1.5, borderColor: C.gold, gap: 4 },
  resLbl: { color: C.muted, fontWeight: "800", letterSpacing: 2, fontSize: 11 },
  resScore: { color: C.gold, fontSize: 56, fontWeight: "900" },
  resSub: { color: C.white, fontSize: 13, fontWeight: "700" },
  resRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  stat: { flex: 1, alignItems: "center", padding: spacing.sm, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.06)" },
  statLbl: { color: C.muted, fontSize: 10, fontWeight: "800" },
  statVal: { color: C.white, fontSize: 15, fontWeight: "900", marginTop: 2 },
  review: { padding: spacing.md, borderRadius: radius.md, backgroundColor: C.glass, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", gap: 2 },
  reviewQ: { color: C.white, fontWeight: "700", fontSize: 13, paddingRight: 40 },
  reviewKey: { color: C.muted, fontSize: 12 },
  reviewPts: { position: "absolute", right: spacing.md, top: spacing.md, fontWeight: "900", fontSize: 16 },
  resBtns: { flexDirection: "row", gap: spacing.sm },
});
