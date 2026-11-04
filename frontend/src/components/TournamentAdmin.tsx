import { View, Text, Pressable, StyleSheet, Switch, ActivityIndicator, Linking } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useCallback, useEffect, useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { api } from "@/src/api";
import { CATEGORY_LABEL, QUIZ_CATEGORY_KEYS, type Category } from "@/src/data/quiz";
import { Alert, Platform } from "react-native";

type Video = {
  video_id: string;
  name: string;
  url: string;
  caption?: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

export default function TournamentAdmin() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [videos, setVideos] = useState<Video[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cats, setCats] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const loadVideos = useCallback(() => {
    api<Video[]>("/admin/royal/videos?status=pending").then(setVideos).catch(() => setVideos([]));
  }, []);

  useEffect(() => {
    api<{ enabled: boolean; categories: string[] }>("/tournament/status")
      .then((r) => {
        setEnabled(r.enabled);
        setCats(r.categories);
      })
      .catch(() => setEnabled(false));
    loadVideos();
  }, [loadVideos]);

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      const r = await api<{ enabled: boolean }>("/admin/tournament", {
        method: "PUT",
        body: JSON.stringify({ enabled: next }),
      });
      setEnabled(r.enabled);
    } catch {}
    setSaving(false);
  };

  const toggleCat = async (k: Category) => {
    const next = cats.includes(k) ? cats.filter((c) => c !== k) : [...cats, k];
    if (next.length === 0) return setNote("Minimal 1 kategori harus aktif.");
    setNote(null);
    setCats(next);
    try {
      const r = await api<{ categories: string[] }>("/admin/tournament", {
        method: "PUT",
        body: JSON.stringify({ categories: next }),
      });
      setCats(r.categories);
    } catch {
      setNote("Gagal menyimpan kategori.");
    }
  };

  const doReset = async () => {
    try {
      const r = await api<{ cleared: number }>("/admin/tournament/reset", { method: "POST" });
      setNote(`Peringkat Tournament direset (${r.cleared} baris diarsipkan).`);
    } catch {
      setNote("Gagal reset peringkat.");
    }
  };

  const confirmReset = () => {
    const msg = "Semua poin Classic, Time Attack & Royal Tournament akan dikosongkan untuk event baru. Lanjutkan?";
    if (Platform.OS === "web") {
      if (window.confirm(msg)) doReset();
    } else {
      Alert.alert("Reset Peringkat Tournament", msg, [
        { text: "Batal", style: "cancel" },
        { text: "Reset", style: "destructive", onPress: doReset },
      ]);
    }
  };

  const review = async (id: string, approve: boolean) => {
    setBusyId(id);
    try {
      await api(`/admin/royal/videos/${id}/review`, { method: "POST", body: JSON.stringify({ approve }) });
      setVideos((v) => v.filter((x) => x.video_id !== id));
    } catch {}
    setBusyId(null);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.label}>TOURNAMENT</Text>
      <View style={styles.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Mode Tournament {enabled ? "AKTIF" : "NONAKTIF"}</Text>
          <Text style={styles.sub}>
            Saat nonaktif, tombol Tournament tetap tampil tapi terkunci. Data peringkat tetap tersimpan.
          </Text>
        </View>
        {enabled === null || saving ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : (
          <Switch
            testID="tournament-toggle"
            value={enabled}
            onValueChange={toggle}
            trackColor={{ false: colors.surfaceTertiary, true: colors.brandPrimary }}
            thumbColor={colors.onSurface}
          />
        )}
      </View>

      <View style={styles.divider} />
      <Text style={styles.title}>Kategori soal Tournament</Text>
      <Text style={styles.sub}>Hanya kategori yang aktif yang masuk ke soal Classic & Time Attack Tournament.</Text>
      <View style={styles.chips}>
        {QUIZ_CATEGORY_KEYS.map((k) => {
          const on = cats.includes(k);
          return (
            <Pressable
              key={k}
              testID={`tcat-${k}`}
              disabled={enabled === null}
              onPress={() => toggleCat(k)}
              style={[styles.chip, on && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}
            >
              <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={14} color={on ? colors.onBrandPrimary : colors.muted} />
              <Text style={[styles.chipTxt, on && { color: colors.onBrandPrimary }]}>{CATEGORY_LABEL[k]}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.divider} />
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Reset poin peringkat</Text>
          <Text style={styles.sub}>Tournament = event 1 kali. Kosongkan semua papan sebelum event baru (data lama diarsipkan).</Text>
        </View>
        <Pressable testID="tournament-reset" onPress={confirmReset} style={styles.resetBtn}>
          <Ionicons name="refresh-circle" size={18} color={colors.onError} />
          <Text style={styles.resetTxt}>RESET</Text>
        </Pressable>
      </View>
      {note && <Text testID="tournament-note" style={styles.sub}>{note}</Text>}

      <View style={styles.divider} />
      <View style={styles.headRow}>
        <Text style={styles.title}>Video Royal menunggu ({videos.length})</Text>
        <Pressable testID="royal-videos-refresh" onPress={loadVideos} hitSlop={10}>
          <Ionicons name="refresh" size={18} color={colors.muted} />
        </Pressable>
      </View>
      {videos.length === 0 ? (
        <Text style={styles.sub}>Tidak ada video yang perlu ditinjau.</Text>
      ) : (
        videos.map((v) => (
          <View key={v.video_id} testID={`admin-video-${v.video_id}`} style={styles.videoRow}>
            <Pressable style={{ flex: 1 }} onPress={() => Linking.openURL(v.url).catch(() => {})}>
              <Text style={styles.videoName}>{v.name}</Text>
              <Text numberOfLines={1} style={styles.videoUrl}>{v.url}</Text>
              {!!v.caption && <Text numberOfLines={2} style={styles.sub}>{v.caption}</Text>}
            </Pressable>
            {busyId === v.video_id ? (
              <ActivityIndicator color={colors.brandPrimary} />
            ) : (
              <View style={styles.actions}>
                <Pressable
                  testID={`approve-video-${v.video_id}`}
                  onPress={() => review(v.video_id, true)}
                  style={[styles.actBtn, { backgroundColor: colors.success }]}
                >
                  <Ionicons name="checkmark" size={18} color={colors.onSuccess} />
                </Pressable>
                <Pressable
                  testID={`reject-video-${v.video_id}`}
                  onPress={() => review(v.video_id, false)}
                  style={[styles.actBtn, { backgroundColor: colors.error }]}
                >
                  <Ionicons name="close" size={18} color={colors.onError} />
                </Pressable>
              </View>
            )}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.brandSecondary,
    gap: spacing.md,
  },
  label: { color: colors.brandSecondary, fontSize: 12, letterSpacing: 2, fontWeight: "800" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  title: { color: colors.onSurface, fontWeight: "800", fontSize: 14 },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2, lineHeight: 17 },
  divider: { height: 1, backgroundColor: colors.border },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, minHeight: 36,
  },
  chipTxt: { color: colors.onSurface, fontSize: 12, fontWeight: "700" },
  resetBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.error,
    paddingHorizontal: spacing.md, borderRadius: radius.pill, minHeight: 40,
  },
  resetTxt: { color: colors.onError, fontWeight: "900", fontSize: 12 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  videoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  videoName: { color: colors.onSurface, fontWeight: "700", fontSize: 13 },
  videoUrl: { color: colors.info, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: "row", gap: spacing.sm },
  actBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
