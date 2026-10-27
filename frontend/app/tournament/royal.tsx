import { View, Text, Pressable, StyleSheet, TextInput, ActivityIndicator, RefreshControl, Linking } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useCallback, useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/contexts/auth";

type Mission = {
  key: string;
  title: string;
  desc: string;
  points: number;
  daily_limit: number;
  done_today: number;
  icon: string;
};
type Video = { video_id: string; url: string; caption?: string | null; status: "pending" | "approved" | "rejected"; created_at: string };
type Me = { enabled: boolean; royal_points: number; missions: Mission[]; boards: { royal: { rank: number | null } }; videos: Video[] };

const STATUS_LABEL: Record<Video["status"], { label: string; color: string }> = {
  pending: { label: "Menunggu admin", color: colors.warning },
  approved: { label: "Disetujui · +20", color: colors.success },
  rejected: { label: "Ditolak", color: colors.error },
};

export default function RoyalScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!user) return setLoading(false);
    try {
      setMe(await api<Me>("/tournament/me"));
    } catch {
      setMe(null);
    }
    setLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const action = (key: string) => {
    if (key === "like_news" || key === "comment_news") router.push("/news");
    else if (key === "play_classic") router.push({ pathname: "/quiz", params: { mode: "t_classic", category: "tournament" } });
    else if (key === "play_time_attack")
      router.push({ pathname: "/quiz", params: { mode: "t_time_attack", category: "tournament" } });
  };

  const submitVideo = async () => {
    const u = url.trim();
    if (!/^https?:\/\/\S+\.\S+/.test(u)) {
      setMsg({ ok: false, text: "Masukkan link video yang valid (diawali https://)." });
      return;
    }
    setSending(true);
    setMsg(null);
    try {
      await api("/royal/videos", { method: "POST", body: JSON.stringify({ url: u, caption: caption.trim() || null }) });
      setUrl("");
      setCaption("");
      setMsg({ ok: true, text: "Video terkirim! Poin masuk setelah disetujui admin." });
      load();
    } catch (e) {
      const s = String(e);
      setMsg({
        ok: false,
        text: s.includes("daily_limit")
          ? "Kamu sudah kirim video hari ini. Coba lagi besok ya!"
          : s.includes("tournament_closed")
            ? "Tournament sedang ditutup."
            : "Gagal mengirim video. Coba lagi.",
      });
    } finally {
      setSending(false);
    }
  };

  if (!user) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="ribbon" size={56} color={colors.brandSecondary} />
        <Text style={styles.title}>Masuk untuk ikut Royal</Text>
        <Pressable testID="royal-login" onPress={() => router.push("/login")} style={styles.cta}>
          <Text style={styles.ctaTxt}>MASUK</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTag}>TOURNAMENT</Text>
          <Text style={styles.headerTitle}>ROYAL 👑</Text>
        </View>
      </View>

      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + spacing.xl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.brandPrimary}
          />
        }
      >
        {loading || !me ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xxl }} />
        ) : (
          <>
            <View testID="royal-points-card" style={styles.pointsCard}>
              <Text style={styles.pointsLabel}>POIN ROYAL KAMU</Text>
              <Text testID="royal-points" style={styles.points}>{me.royal_points}</Text>
              <Text style={styles.pointsRank}>
                {me.boards.royal.rank ? `Peringkat #${me.boards.royal.rank}` : "Belum masuk peringkat"}
              </Text>
              <Pressable
                testID="royal-board-link"
                onPress={() => router.push("/tournament/leaderboard")}
                style={styles.boardLink}
              >
                <Ionicons name="podium" size={14} color={colors.onBrandSecondary} />
                <Text style={styles.boardLinkTxt}>LIHAT PERINGKAT</Text>
              </Pressable>
            </View>

            {!me.enabled && (
              <View style={styles.closedCard}>
                <Ionicons name="lock-closed" size={18} color={colors.error} />
                <Text style={styles.closedTxt}>Tournament ditutup — misi tidak menambah poin saat ini.</Text>
              </View>
            )}

            <Text style={styles.section}>MISI HARIAN</Text>
            {me.missions.map((m) => {
              const full = m.done_today >= m.daily_limit;
              return (
                <View key={m.key} testID={`mission-${m.key}`} style={styles.mission}>
                  <View style={styles.missionIcon}>
                    <Ionicons name={m.icon as any} size={22} color={colors.brandSecondary} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.missionTitle}>{m.title}</Text>
                    <Text style={styles.missionDesc}>{m.desc}</Text>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${(m.done_today / m.daily_limit) * 100}%` },
                          full && { backgroundColor: colors.success },
                        ]}
                      />
                    </View>
                    <Text style={styles.missionCount}>
                      {m.done_today}/{m.daily_limit} hari ini
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 6 }}>
                    <Text style={styles.missionPts}>+{m.points}</Text>
                    {m.key !== "submit_video" &&
                      (full ? (
                        <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                      ) : (
                        <Pressable
                          testID={`mission-go-${m.key}`}
                          disabled={!me.enabled}
                          onPress={() => action(m.key)}
                          style={styles.goBtn}
                        >
                          <Text style={styles.goTxt}>AYO</Text>
                        </Pressable>
                      ))}
                  </View>
                </View>
              );
            })}

            <Text style={styles.section}>KIRIM LINK VIDEO</Text>
            <View style={styles.formCard}>
              <Text style={styles.formHint}>
                Bagikan video dukunganmu (YouTube, TikTok, Instagram). Admin akan meninjau, poin +20 masuk setelah
                disetujui. Maks 1 video per hari.
              </Text>
              <TextInput
                testID="video-url-input"
                value={url}
                onChangeText={setUrl}
                placeholder="https://..."
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                keyboardType="url"
                style={styles.input}
              />
              <TextInput
                testID="video-caption-input"
                value={caption}
                onChangeText={setCaption}
                placeholder="Keterangan (opsional)"
                placeholderTextColor={colors.muted}
                maxLength={200}
                style={styles.input}
              />
              {msg && (
                <Text testID="video-msg" style={[styles.msg, { color: msg.ok ? colors.success : colors.error }]}>
                  {msg.text}
                </Text>
              )}
              <Pressable
                testID="video-submit-button"
                disabled={sending || !me.enabled}
                onPress={submitVideo}
                style={[styles.cta, (sending || !me.enabled) && { opacity: 0.6 }]}
              >
                {sending ? (
                  <ActivityIndicator color={colors.onBrandPrimary} />
                ) : (
                  <>
                    <Ionicons name="send" size={16} color={colors.onBrandPrimary} />
                    <Text style={styles.ctaTxt}>KIRIM VIDEO</Text>
                  </>
                )}
              </Pressable>
            </View>

            {me.videos.length > 0 && (
              <>
                <Text style={styles.section}>VIDEO SAYA</Text>
                {me.videos.map((v) => (
                  <Pressable
                    key={v.video_id}
                    testID={`my-video-${v.video_id}`}
                    onPress={() => Linking.openURL(v.url).catch(() => {})}
                    style={styles.videoRow}
                  >
                    <Ionicons name="videocam" size={18} color={colors.muted} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.videoUrl}>{v.caption || v.url}</Text>
                      <Text style={styles.videoDate}>{new Date(v.created_at).toLocaleDateString("id-ID")}</Text>
                    </View>
                    <Text style={[styles.videoStatus, { color: STATUS_LABEL[v.status].color }]}>
                      {STATUS_LABEL[v.status].label}
                    </Text>
                  </Pressable>
                ))}
              </>
            )}
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: "900" },
  header: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  backBtn: { padding: spacing.xs },
  headerTag: { color: colors.muted, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  headerTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "900", letterSpacing: 2 },
  pointsCard: {
    alignItems: "center",
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.brandTertiary,
    borderWidth: 1,
    borderColor: colors.brandSecondary,
  },
  pointsLabel: { color: colors.onBrandTertiary, fontSize: 11, letterSpacing: 2, fontWeight: "800" },
  points: { color: colors.brandSecondary, fontSize: 56, fontWeight: "900", marginTop: 4 },
  pointsRank: { color: colors.onSurface, fontSize: 13, fontWeight: "700" },
  boardLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.md,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  boardLinkTxt: { color: colors.onBrandSecondary, fontWeight: "900", fontSize: 12, letterSpacing: 1 },
  closedCard: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  closedTxt: { flex: 1, color: colors.onSurface, fontSize: 13 },
  section: { color: colors.muted, fontSize: 12, letterSpacing: 2, fontWeight: "800", marginTop: spacing.sm },
  mission: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  missionIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  missionTitle: { color: colors.onSurface, fontWeight: "800", fontSize: 14 },
  missionDesc: { color: colors.muted, fontSize: 12 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary, overflow: "hidden", marginTop: 2 },
  progressFill: { height: "100%", backgroundColor: colors.brandSecondary },
  missionCount: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "600" },
  missionPts: { color: colors.brandSecondary, fontWeight: "900", fontSize: 16 },
  goBtn: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    minHeight: 32,
    justifyContent: "center",
  },
  goTxt: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 11, letterSpacing: 1 },
  formCard: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formHint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.onSurface,
    fontSize: 14,
  },
  msg: { fontSize: 13, fontWeight: "600" },
  cta: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    minHeight: 48,
  },
  ctaTxt: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 14, letterSpacing: 1.5 },
  videoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  videoUrl: { color: colors.onSurface, fontSize: 13, fontWeight: "600" },
  videoDate: { color: colors.muted, fontSize: 11, marginTop: 2 },
  videoStatus: { fontSize: 11, fontWeight: "800" },
});
