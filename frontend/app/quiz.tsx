import { View, Text, Pressable, StyleSheet, ScrollView, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";

import { colors, radius, spacing } from "@/src/theme";
import { useSkin } from "@/src/contexts/skin";
import { CATEGORY_LABEL, pickQuestions, type Category, type Question } from "@/src/data/quiz";
import { pickDynamicQuestions, type ThemeFilter } from "@/src/data/questions";
import { useCountdown } from "@/src/hooks/useCountdown";
import { api } from "@/src/api";
import { absoluteFileUrl, useAppSettings } from "@/src/hooks/useAppSettings";
import { LinearGradient } from "expo-linear-gradient";

type Mode = "classic" | "time_attack" | "t_classic" | "t_time_attack";
type CatKey = Category | "all" | "tournament";

const POINT_PER_CORRECT = 100;
const T_QUESTION_SECONDS = 20; // per-question timer in Tournament Classic
const T_SPEED_BONUS_PER_SEC = 5; // up to +100 for an instant answer

export default function QuizScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { accent } = useSkin();
  const { settings } = useAppSettings();
  const customBg = absoluteFileUrl(settings.background_url);
  const params = useLocalSearchParams<{ mode: Mode; category: CatKey; theme?: string }>();
  const mode = (params.mode ?? "classic") as Mode;
  const isTournament = mode === "t_classic" || mode === "t_time_attack";
  const category = (isTournament ? "tournament" : params.category ?? "all") as CatKey;
  const themeId = isTournament ? undefined : params.theme;
  const classicLike = mode === "classic" || mode === "t_classic";
  const CLASSIC_COUNT = mode === "t_classic" ? 20 : 10;
  const TIME_SECONDS = mode === "t_time_attack" ? 90 : 60;
  const catLabel = category === "tournament" ? "TOURNAMENT" : CATEGORY_LABEL[category];

  const [queue, setQueue] = useState<Question[]>(() =>
    category === "tournament" ? [] : pickQuestions(category, classicLike ? CLASSIC_COUNT : 50),
  );
  const [loadingBank, setLoadingBank] = useState(true);
  const [closed, setClosed] = useState(false);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [answered, setAnswered] = useState<number | null>(null);
  const [showFlash, setShowFlash] = useState<"correct" | "wrong" | null>(null);

  const flashOpacity = useSharedValue(0);
  const gameIdRef = useRef<string | null>(null);
  const finishedRef = useRef(false);
  const scoreRef = useRef(0);
  const correctRef = useRef(0);
  const answeredCountRef = useRef(0); // total questions answered (survives TA reshuffles)

  const current = queue[index];

  // Keep refs in sync with latest state so finish() always reads fresh values
  // even when called from stale closures (timeouts / timer callbacks).
  scoreRef.current = score;
  correctRef.current = correctCount;

  // Time attack countdown
  const timeLeft = useCountdown(TIME_SECONDS, !classicLike, () => {
    if (!finishedRef.current) finish();
  });

  // Tournament Classic: 20s per question; time-out counts as a wrong answer.
  const [qTimeLeft, setQTimeLeft] = useState(T_QUESTION_SECONDS);
  const qTimeLeftRef = useRef(T_QUESTION_SECONDS);
  qTimeLeftRef.current = qTimeLeft;
  const chooseRef = useRef<(i: number) => void>(() => {});
  useEffect(() => {
    if (mode !== "t_classic" || !queue[index] || answered !== null) return;
    setQTimeLeft(T_QUESTION_SECONDS);
    const id = setInterval(() => {
      setQTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(id);
          setTimeout(() => chooseRef.current(-1), 0);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, queue, answered === null]);

  const finish = (finalScore?: number, finalCorrect?: number) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const useScore = finalScore ?? scoreRef.current;
    const useCorrect = finalCorrect ?? correctRef.current;
    router.replace({
      pathname: "/result",
      params: {
        mode,
        category,
        score: String(useScore),
        correct: String(useCorrect),
        total: String(classicLike ? CLASSIC_COUNT : Math.max(answeredCountRef.current, useCorrect)),
        ...(params.challenge ? { challenge: String(params.challenge) } : {}),
        ...(gameIdRef.current ? { game_id: gameIdRef.current } : {}),
      },
    });
  };

  const flash = (kind: "correct" | "wrong") => {
    setShowFlash(kind);
    flashOpacity.value = 0.9;
    flashOpacity.value = withTiming(0, { duration: 600 });
    setTimeout(() => setShowFlash(null), 650);
  };

  const choose = (i: number) => {
    if (answered !== null) return;
    setAnswered(i);
    answeredCountRef.current += 1;
    const correct = i === current.answerIndex;
    const gained =
      mode === "t_classic"
        ? POINT_PER_CORRECT + Math.max(0, qTimeLeftRef.current) * T_SPEED_BONUS_PER_SEC
        : POINT_PER_CORRECT;
    const nextScore = correct ? score + gained : score;
    const nextCorrect = correct ? correctCount + 1 : correctCount;
    // Update refs immediately so TA timer / other timeouts see fresh values.
    scoreRef.current = nextScore;
    correctRef.current = nextCorrect;
    if (correct) {
      setScore(nextScore);
      setCorrectCount(nextCorrect);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      flash("correct");
    } else {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      flash("wrong");
    }
    setTimeout(() => {
      if (finishedRef.current) return;
      // Advance
      if (classicLike) {
        if (index + 1 >= Math.min(CLASSIC_COUNT, queue.length)) {
          finish(nextScore, nextCorrect);
        } else {
          setIndex((v) => v + 1);
          setAnswered(null);
        }
      } else {
        // Time attack: cycle through, reshuffle when empty
        if (index + 1 >= queue.length) {
          pickDynamicQuestions(category, 50).then((q) => {
            if (q.length > 0) setQueue(q);
            else setQueue(pickQuestions(category, 50));
            setIndex(0);
          });
        } else {
          setIndex((v) => v + 1);
        }
        setAnswered(null);
      }
    }, 900);
  };

  chooseRef.current = choose;

  // Animate timer width
  const timerStyle = useAnimatedStyle(() => {
    const pct =
      mode === "t_classic"
        ? qTimeLeft / T_QUESTION_SECONDS
        : !classicLike
          ? timeLeft / TIME_SECONDS
          : (index + 1) / CLASSIC_COUNT;
    return { width: `${Math.max(0, Math.min(1, pct)) * 100}%` };
  });

  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));

  useEffect(() => {
    let active = true;
    (async () => {
      if (isTournament) {
        const st = await api<{ enabled: boolean }>("/tournament/status").catch(() => ({ enabled: false }));
        if (!st.enabled) {
          if (active) {
            setClosed(true);
            setLoadingBank(false);
          }
          return;
        }
      }
      let themeFilter: ThemeFilter | null = null;
      if (themeId) {
        try {
          const t = await api<{ id: string; filter_type: string; filter_value: any }>("/weekly-theme");
          if (t.id === themeId) themeFilter = { id: t.id, filter_type: t.filter_type, filter_value: t.filter_value };
        } catch {}
      }
      const q = await pickDynamicQuestions(category, classicLike ? CLASSIC_COUNT : 50, themeFilter);
      if (active && q.length > 0) {
        setQueue(q);
        setIndex(0);
        // One-time server ticket so this game's score can be submitted exactly once.
        api<{ game_id: string }>("/games/start", { method: "POST", body: JSON.stringify({ mode }) })
          .then((r) => {
            gameIdRef.current = r.game_id;
          })
          .catch(() => {});
      }
      setLoadingBank(false);
    })();
    return () => {
      active = false;
      finishedRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!current || closed) {
    const isLoading = loadingBank;
    return (
      <View style={styles.container}>
        {customBg && (
          <>
            <Image source={customBg} style={StyleSheet.absoluteFill} contentFit="cover" />
            <LinearGradient
              colors={["rgba(15,17,21,0.75)", "rgba(15,17,21,0.95)", colors.surface]}
              style={StyleSheet.absoluteFill}
            />
          </>
        )}
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable testID="quit-button" onPress={() => router.replace("/")} hitSlop={10} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.catTag}>{catLabel}</Text>
          </View>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.emptyWrap}>
          <Ionicons
            name={closed ? "lock-closed" : isLoading ? "hourglass-outline" : "alert-circle-outline"}
            size={60}
            color={colors.muted}
          />
          <Text style={styles.emptyTitle}>
            {closed ? "Tournament belum dibuka" : isLoading ? "Memuat soal..." : "Belum ada soal"}
          </Text>
          {!isLoading && !closed && (
            <Text style={styles.emptyBody}>
              Admin belum menambahkan soal untuk kategori{" "}
              <Text style={{ color: colors.onSurface, fontWeight: "700" }}>
                {catLabel}
              </Text>
              . Coba kategori lain atau minta admin menambahkan soal lewat dashboard.
            </Text>
          )}
          {!isLoading && (
            <Pressable
              testID="back-to-category"
              onPress={() => router.replace(isTournament ? "/tournament" : "/category")}
              style={styles.emptyCta}
            >
              <Ionicons name="chevron-back" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.emptyCtaTxt}>{isTournament ? "KEMBALI KE TOURNAMENT" : "PILIH KATEGORI LAIN"}</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {customBg && (
        <>
          <Image
            source={customBg}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          <LinearGradient
            colors={["rgba(15,17,21,0.75)", "rgba(15,17,21,0.95)", colors.surface]}
            style={StyleSheet.absoluteFill}
          />
        </>
      )}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="quit-button" onPress={() => router.replace("/")} hitSlop={10} style={styles.closeBtn}>
          <Ionicons name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.catTag}>{catLabel}</Text>
          <Text testID="progress-text" style={styles.progress}>
            {mode === "t_classic"
              ? `${qTimeLeft}s · Q${index + 1}/${Math.min(CLASSIC_COUNT, queue.length)}`
              : classicLike
                ? `Q${index + 1}/${CLASSIC_COUNT}`
                : `${timeLeft}s · Q${index + 1}`}
          </Text>
        </View>
        <View style={styles.scorePill}>
          <Ionicons name="flame" size={14} color={colors.brandSecondary} />
          <Text testID="score-text" style={styles.scoreTxt}>{score}</Text>
        </View>
      </View>

      <View style={styles.timerTrack}>
        <Animated.View
          style={[
            styles.timerFill,
            timerStyle,
            {
              backgroundColor:
                (!classicLike && timeLeft <= 10) || (mode === "t_classic" && qTimeLeft <= 5)
                  ? colors.error
                  : accent.primary,
            },
          ]}
        />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {current.image ? (
          <Animated.View entering={FadeIn.duration(300)} style={styles.imageWrap} key={current.id}>
            <Image source={current.image} style={styles.image} contentFit="cover" />
          </Animated.View>
        ) : (
          <View style={styles.textPromptWrap}>
            <Ionicons name="football" size={44} color={colors.brandPrimary} />
          </View>
        )}

        <Text testID="question-prompt" style={styles.prompt}>{current.prompt}</Text>

        <View style={styles.options}>
          {current.options.map((opt, i) => {
            const isAnswer = i === current.answerIndex;
            const picked = answered === i;
            const revealed = answered !== null;
            const borderColor = revealed
              ? isAnswer
                ? colors.success
                : picked
                  ? colors.error
                  : colors.border
              : colors.border;
            const bg = revealed
              ? isAnswer
                ? "rgba(46,125,50,0.18)"
                : picked
                  ? "rgba(211,47,47,0.18)"
                  : colors.surfaceSecondary
              : colors.surfaceSecondary;
            return (
              <Pressable
                key={i}
                testID={`option-${i}`}
                onPress={() => choose(i)}
                disabled={revealed}
                style={({ pressed }) => [
                  styles.option,
                  { backgroundColor: bg, borderColor },
                  pressed && !revealed && { transform: [{ scale: 0.985 }] },
                ]}
              >
                <View style={[styles.optLetter, { backgroundColor: accent.primary }]}>
                  <Text style={[styles.optLetterTxt, { color: accent.onPrimary }]}>{String.fromCharCode(65 + i)}</Text>
                </View>
                <Text style={styles.optText}>{opt}</Text>
                {revealed && isAnswer && (
                  <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                )}
                {revealed && picked && !isAnswer && (
                  <Ionicons name="close-circle" size={22} color={colors.error} />
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {showFlash && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            flashStyle,
            {
              pointerEvents: "none",
              backgroundColor:
                showFlash === "correct" ? "rgba(46,125,50,0.35)" : "rgba(211,47,47,0.35)",
            },
          ]}
        >
          <View style={styles.flashCenter}>
            <Ionicons
              name={showFlash === "correct" ? "checkmark-circle" : "close-circle"}
              size={120}
              color={showFlash === "correct" ? colors.success : colors.error}
            />
            <Text style={styles.flashText}>{showFlash === "correct" ? "BENAR!" : "SALAH"}</Text>
          </View>
        </Animated.View>
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
  closeBtn: { padding: spacing.xs },
  headerCenter: { flex: 1, alignItems: "center" },
  catTag: { color: colors.muted, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  progress: { color: colors.onSurface, fontWeight: "900", fontSize: 16, letterSpacing: 1 },
  scorePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scoreTxt: { color: colors.brandSecondary, fontWeight: "900", fontSize: 14 },
  timerTrack: {
    height: 4,
    backgroundColor: colors.surfaceSecondary,
    marginHorizontal: spacing.lg,
    borderRadius: 2,
    overflow: "hidden",
  },
  timerFill: { height: "100%" },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  imageWrap: {
    width: "100%",
    aspectRatio: 1.4,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceSecondary,
    marginBottom: spacing.lg,
  },
  image: { width: "100%", height: "100%" },
  textPromptWrap: {
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  prompt: {
    color: colors.onSurface,
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 28,
    marginBottom: spacing.lg,
  },
  options: { gap: spacing.md as number },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    minHeight: 64,
  },
  optLetter: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  optLetterTxt: { color: colors.onSurface, fontWeight: "900", fontSize: 13 },
  optText: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "600",
  },
  flashCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  flashText: {
    color: colors.onSurface,
    fontWeight: "900",
    fontSize: 32,
    letterSpacing: 4,
    marginTop: spacing.md,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md as number,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: 0.5 },
  emptyBody: { color: colors.muted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  emptyCta: {
    marginTop: spacing.lg,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm as number,
  },
  emptyCtaTxt: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 13, letterSpacing: 1.5 },
});
