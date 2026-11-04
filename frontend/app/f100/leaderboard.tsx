import { View, Text, Pressable, StyleSheet, ScrollView, ImageBackground, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useCallback, useState } from "react";

import { spacing, radius } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/contexts/auth";

const C = { white: "#FFFFFF", gold: "#F2C24E", glass: "rgba(10,22,52,0.85)", muted: "#AEB9D6" };
type Row = { user_id: string; name: string; picture?: string | null; score: number; attempts: number; time_ms: number; accuracy: number; perfect: number };

const fmtTime = (ms: number) => {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function F100Leaderboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => api<Row[]>("/f100/leaderboard").then(setRows).catch(() => setRows([])), []);
  useFocusEffect(
    useCallback(() => {
      load();
      const id = setInterval(load, 15000);
      return () => clearInterval(id);
    }, [load]),
  );

  return (
    <ImageBackground source={require("@/assets/bg/stadium.jpg")} style={styles.container} resizeMode="cover">
      <LinearGradient colors={["rgba(10,40,110,0.55)", "rgba(7,22,55,0.9)", "rgba(7,22,55,0.98)"]} style={StyleSheet.absoluteFill} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} style={styles.sqBtn}>
          <Ionicons name="chevron-back" size={26} color={C.white} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.tag}>FOOTBALL 100</Text>
          <Text style={styles.title}>PERINGKAT</Text>
        </View>
        <View style={{ width: 48 }} />
      </View>
      <Text style={styles.hint}>Total poin akumulasi dari semua percobaan</Text>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={C.gold} />}
      >
        {rows === null ? (
          <ActivityIndicator color={C.gold} style={{ marginTop: spacing.xxl }} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>Belum ada pemain. Jadilah yang pertama!</Text>
        ) : (
          rows.map((r, i) => {
            const mine = r.user_id === user?.user_id;
            return (
              <View key={r.user_id} testID={`f100-row-${i}`} style={[styles.row, mine && { borderColor: C.gold }]}>
                <Text style={[styles.rank, i < 3 && { color: C.gold }]}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}</Text>
                {r.picture ? <Image source={r.picture} style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarPh]}><Ionicons name="person" size={18} color={C.white} /></View>}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={styles.name}>{r.name}{mine ? " (Kamu)" : ""}</Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>{r.attempts}x main</Text>
                    <Text style={styles.meta}>⏱ {fmtTime(r.time_ms)}</Text>
                    <Text style={styles.meta}>🎯 {r.accuracy}%</Text>
                  </View>
                </View>
                <Text style={styles.score}>{r.score}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#071637" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  sqBtn: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: C.glass, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  tag: { color: C.gold, fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  title: { color: C.white, fontSize: 24, fontWeight: "900", fontStyle: "italic" },
  hint: { color: C.muted, fontSize: 12, textAlign: "center" },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  empty: { color: C.muted, textAlign: "center", marginTop: spacing.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: C.glass, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.1)" },
  rank: { width: 34, color: C.muted, fontWeight: "900", fontSize: 15 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarPh: { backgroundColor: "#1B2B55", alignItems: "center", justifyContent: "center" },
  name: { color: C.white, fontWeight: "800", fontSize: 14 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: 2 },
  meta: { color: C.muted, fontSize: 11, fontWeight: "600" },
  score: { color: C.gold, fontWeight: "900", fontSize: 20 },
});
