import { View, Text, Pressable, StyleSheet, Switch, ActivityIndicator, Linking } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useCallback, useEffect, useState } from "react";

import { colors, radius, spacing } from "@/src/theme";
import { api } from "@/src/api";

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

  const loadVideos = useCallback(() => {
    api<Video[]>("/admin/royal/videos?status=pending").then(setVideos).catch(() => setVideos([]));
  }, []);

  useEffect(() => {
    api<{ enabled: boolean }>("/tournament/status")
      .then((r) => setEnabled(r.enabled))
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
