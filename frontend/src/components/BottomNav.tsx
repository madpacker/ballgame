import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";

import { radius, spacing } from "@/src/theme";

// Game-lobby navigation bar — fixed dark-glass palette, same in every theme.
const BAR = "rgba(16,24,48,0.96)";
const IDLE = "#AEB9D6";
const ACTIVE = "#FFFFFF";

type Key = "leaderboard" | "matches" | "news" | "store" | "profile";
const ITEMS: { key: Key; label: string; icon: string; path: string }[] = [
  { key: "leaderboard", label: "Leaderboard", icon: "podium", path: "/leaderboard" },
  { key: "matches", label: "Prediksi", icon: "football", path: "/matches" },
  { key: "news", label: "Berita", icon: "newspaper", path: "/news" },
  { key: "store", label: "Store", icon: "storefront", path: "/store" },
  { key: "profile", label: "Profil", icon: "person", path: "/profile" },
];

export default function BottomNav({ active, onPlay }: { active?: Key; onPlay?: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      <View style={styles.bar}>
        {ITEMS.map((it) => {
          const on = it.key === active;
          return (
            <Pressable
              key={it.key}
              testID={`nav-${it.key}`}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.selectionAsync();
                if (!on) router.push(it.path as any);
              }}
              style={styles.item}
            >
              <Ionicons name={it.icon as any} size={22} color={on ? ACTIVE : IDLE} />
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.label, on && { color: ACTIVE }]}>
                {it.label}
              </Text>
            </Pressable>
          );
        })}
        {onPlay && (
          <Pressable testID="nav-play" onPress={onPlay} style={styles.playWrap}>
            <LinearGradient colors={["#5CC26A", "#2E7D3A"]} style={styles.play}>
              <Text style={styles.playTop}>MULAI</Text>
              <Text style={styles.playBottom}>PERTANDINGAN</Text>
            </LinearGradient>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.sm, paddingTop: spacing.xs },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: BAR,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  item: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 48, gap: 2 },
  label: { color: IDLE, fontSize: 8, fontWeight: "700", letterSpacing: -0.2 },
  playWrap: { flex: 1.35, marginLeft: 2 },
  play: {
    borderRadius: radius.md,
    paddingVertical: 6,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
  },
  playTop: { color: ACTIVE, fontWeight: "900", fontStyle: "italic", fontSize: 15 },
  playBottom: { color: ACTIVE, fontWeight: "900", fontStyle: "italic", fontSize: 9 },
});
