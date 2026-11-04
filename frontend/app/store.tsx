import { View, Text, Pressable, StyleSheet, ScrollView, ImageBackground, ActivityIndicator, Alert, Platform } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useCallback, useState } from "react";

import { spacing, radius } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/contexts/auth";
import BottomNav from "@/src/components/BottomNav";
import FutCard from "@/src/components/FutCard";

const C = { white: "#FFFFFF", gold: "#F2C24E", glass: "rgba(12,26,62,0.86)", muted: "#AEB9D6", purple: "#3A2A6A", red: "#D7262E" };
const UPCOMING = 6; // placeholder slots shown under "FUTCARD MENDATANG"

export type StoreCard = { card_id: string; title: string; image_url?: string | null; price: number; stock: number };

const fmt = (n: number) => n.toLocaleString("id-ID");

export default function StoreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [cards, setCards] = useState<StoreCard[] | null>(null);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [balance, setBalance] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    api<StoreCard[]>("/store/cards").then(setCards).catch(() => setCards([]));
    if (user) {
      api<{ balance: number }>("/me/xp").then((r) => setBalance(r.balance)).catch(() => {});
      api<{ card_id: string }[]>("/me/cards").then((r) => setOwned(new Set(r.map((c) => c.card_id)))).catch(() => {});
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const notify = (t: string, m: string) => (Platform.OS === "web" ? window.alert(`${t}\n${m}`) : Alert.alert(t, m));

  const redeem = async (c: StoreCard) => {
    if (!user) return router.push("/login");
    setBusy(c.card_id);
    try {
      const r = await api<{ balance: number }>(`/store/cards/${c.card_id}/redeem`, { method: "POST" });
      setBalance(r.balance);
      setOwned((s) => new Set(s).add(c.card_id));
      setCards((cs) => cs?.map((x) => (x.card_id === c.card_id ? { ...x, stock: x.stock - 1 } : x)) ?? null);
      notify("Berhasil!", `${c.title} masuk ke Koleksi Kartu di profilmu.`);
    } catch (e) {
      const s = String(e);
      notify(
        "Gagal menukar",
        s.includes("insufficient") ? "Poin XP kamu belum cukup." : s.includes("out_of_stock") ? "Stok kartu habis." : s.includes("already_owned") ? "Kamu sudah punya kartu ini." : "Coba lagi nanti.",
      );
    } finally {
      setBusy(null);
    }
  };

  const placeholders = Math.max(0, UPCOMING);

  return (
    <ImageBackground source={require("@/assets/bg/stadium.jpg")} style={styles.container} resizeMode="cover">
      <LinearGradient colors={["rgba(10,40,110,0.5)", "rgba(7,22,55,0.85)", "rgba(7,22,55,0.98)"]} style={StyleSheet.absoluteFill} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} style={styles.sqBtn}>
          <Ionicons name="chevron-back" size={26} color={C.white} />
        </Pressable>
        <Text style={styles.title}>
          <Text style={{ color: C.gold }}>GAME </Text>STORE
        </Text>
        <View testID="store-balance" style={styles.balance}>
          <Text style={styles.balanceTxt}>{fmt(balance)}</Text>
          <Text style={styles.xpCoin}>XP</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.section}>DAPATKAN FUTCARD SPESIAL</Text>
        {cards === null ? (
          <ActivityIndicator color={C.gold} />
        ) : cards.length === 0 ? (
          <Text style={styles.empty}>Belum ada Futcard. Admin akan segera merilisnya!</Text>
        ) : (
          <View style={styles.grid}>
            {cards.map((c) => {
              const mine = owned.has(c.card_id);
              const soldOut = c.stock <= 0;
              return (
                <View key={c.card_id} testID={`store-card-${c.card_id}`} style={styles.tile}>
                  <FutCard
                    card={c}
                    footer={
                      <>
                        <Text style={styles.price}>🪙 {fmt(c.price)} Poin</Text>
                        <Text style={styles.stock}>Stok {c.stock}</Text>
                        <Pressable
                          testID={`redeem-${c.card_id}`}
                          disabled={mine || soldOut || busy === c.card_id}
                          onPress={() => redeem(c)}
                          style={[styles.tukarWrap, (mine || soldOut) && { opacity: 0.55 }]}
                        >
                          <LinearGradient colors={["#E8424A", "#A3131A"]} style={styles.tukar}>
                            {busy === c.card_id ? (
                              <ActivityIndicator color={C.white} size="small" />
                            ) : (
                              <Text style={styles.tukarTxt}>{mine ? "DIMILIKI" : soldOut ? "HABIS" : "TUKAR"}</Text>
                            )}
                          </LinearGradient>
                        </Pressable>
                      </>
                    }
                  />
                </View>
              );
            })}
          </View>
        )}

        <Text style={styles.section}>FUTCARD MENDATANG</Text>
        <View style={styles.grid}>
          {Array.from({ length: placeholders }).map((_, i) => (
            <View key={i} style={[styles.tile, styles.lockedTile]}>
              <View style={styles.lockedArt}>
                <Text style={styles.q}>?</Text>
              </View>
              <Text style={styles.lockedTxt}>{i % 3 === 2 || i === 4 ? "KOSONG" : "BELUM UPDATE"}</Text>
            </View>
          ))}
        </View>

        <View style={styles.notice}>
          <View style={styles.bang}>
            <Text style={styles.bangTxt}>!</Text>
          </View>
          <Text style={styles.noticeTxt}>
            <Text style={{ color: C.gold, fontWeight: "900" }}>INFO UPDATE: </Text>
            Admin akan segera merilis dan memperbarui daftar Futcard terbaru yang masih kosong ini dengan para pemain andalan berikutnya! Siapkan poin Anda!
          </Text>
        </View>
      </ScrollView>
      <BottomNav active="store" />
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#071637" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  sqBtn: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: C.glass, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  title: { color: "#E6ECF8", fontSize: 26, fontWeight: "900", fontStyle: "italic", textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 1, height: 2 }, textShadowRadius: 3 },
  balance: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.glass, borderRadius: radius.md, paddingHorizontal: spacing.sm, height: 48, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  balanceTxt: { color: C.white, fontSize: 15, fontWeight: "900" },
  xpCoin: { color: "#5A3A00", backgroundColor: C.gold, fontSize: 10, fontWeight: "900", borderRadius: 11, width: 22, height: 22, textAlign: "center", lineHeight: 22, overflow: "hidden" },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  section: { color: C.white, fontSize: 18, fontWeight: "900", textAlign: "center", textShadowColor: "rgba(0,0,0,0.7)", textShadowOffset: { width: 1, height: 2 }, textShadowRadius: 3 },
  empty: { color: C.muted, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing.sm },
  tile: { width: "32%", backgroundColor: C.glass, borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(120,170,255,0.35)", padding: 6, alignItems: "center", gap: 4 },
  price: { color: C.white, fontSize: 11, fontWeight: "700" },
  stock: { color: C.muted, fontSize: 9 },
  tukarWrap: { width: "100%" },
  tukar: { borderRadius: radius.sm, paddingVertical: 8, alignItems: "center", borderWidth: 1.5, borderColor: C.gold, minHeight: 44, justifyContent: "center" },
  tukarTxt: { color: C.white, fontWeight: "900", fontSize: 14 },
  lockedTile: { borderColor: "rgba(170,120,255,0.35)" },
  lockedArt: { width: "80%", aspectRatio: 0.8, borderRadius: radius.sm, backgroundColor: C.purple, borderWidth: 1.5, borderColor: "rgba(242,194,78,0.4)", alignItems: "center", justifyContent: "center" },
  q: { color: "rgba(255,255,255,0.35)", fontSize: 44, fontWeight: "900" },
  lockedTxt: { color: C.muted, fontSize: 10, fontWeight: "700" },
  notice: { flexDirection: "row", gap: spacing.md, alignItems: "center", padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: C.gold, backgroundColor: C.glass },
  bang: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.red, borderWidth: 1.5, borderColor: C.gold, alignItems: "center", justifyContent: "center" },
  bangTxt: { color: C.white, fontSize: 24, fontWeight: "900" },
  noticeTxt: { flex: 1, color: C.white, fontSize: 12, lineHeight: 17 },
});
