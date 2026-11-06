import { View, Text, Pressable, StyleSheet, ScrollView, ImageBackground, ActivityIndicator, Platform, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as ImagePicker from "expo-image-picker";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, runOnJS } from "react-native-reanimated";
import { useCallback, useEffect, useState } from "react";

import { spacing, radius } from "@/src/theme";
import { api, getToken } from "@/src/api";
import { useAuth } from "@/src/contexts/auth";
import { uploadForm } from "@/src/utils/upload";
import { absoluteFileUrl } from "@/src/hooks/useAppSettings";
import CharacterStage, { type Outfit, type WItem } from "@/src/components/CharacterStage";

// Sci-fi locker palette (fixed in every theme).
const C = { cyan: "#36C8FF", orange: "#FF9A2E", white: "#FFFFFF", panel: "rgba(8,22,48,0.82)", slot: "rgba(30,110,180,0.35)" };
const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;
const SIDE_SLOTS = 3;
const ROW_SLOTS = 6;
const FIELD: Record<WItem["kind"], keyof Outfit> = { character: "character_id", top: "top_id", bottom: "bottom_id", shoes: "shoes_id" };

export default function DressingRoom() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [items, setItems] = useState<WItem[] | null>(null);
  const [outfit, setOutfit] = useState<Outfit>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [back, setBack] = useState(false);
  const rot = useSharedValue(0);

  const load = useCallback(() => {
    api<WItem[]>("/wardrobe").then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(() => {
    load();
    if (user) api<Outfit>("/me/outfit").then(setOutfit).catch(() => {});
  }, [load, user]);

  // Default selections: first of each kind until the user picks.
  const of = (k: WItem["kind"]) => (items ?? []).filter((i) => i.kind === k);
  const current: Outfit = {
    character_id: outfit.character_id ?? of("character")[0]?.item_id,
    top_id: outfit.top_id ?? of("top")[0]?.item_id,
    bottom_id: outfit.bottom_id ?? of("bottom")[0]?.item_id,
    shoes_id: outfit.shoes_id ?? of("shoes")[0]?.item_id,
  };

  // Rotation: drag horizontally (or tap the arrows) to spin the character; past 90° shows the back view.
  const updateBack = (deg: number) => setBack(Math.abs(((deg % 360) + 360) % 360 - 180) < 90);
  const pan = Gesture.Pan()
    .onChange((e) => {
      rot.value += e.changeX * 0.8;
      runOnJS(updateBack)(rot.value);
    });
  const spin = (d: number) => {
    const next = rot.value + d;
    rot.value = withSpring(next);
    updateBack(next);
  };
  const stageStyle = useAnimatedStyle(() => {
    const deg = ((rot.value % 360) + 360) % 360;
    // Mirror the back half so the rear image faces the right way.
    const shown = deg > 90 && deg < 270 ? deg - 180 : deg;
    return { transform: [{ perspective: 800 }, { rotateY: `${shown}deg` }] };
  });

  const pick = (k: WItem["kind"], id: string) => {
    if (Platform.OS !== "web") void import("expo-haptics").then((h) => h.selectionAsync());
    setOutfit((o) => ({ ...current, ...o, [FIELD[k]]: id }));
  };

  // Opened by direct link there is no history, so fall back to the lobby.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const notify = (t: string, m: string) => (Platform.OS === "web" ? window.alert(`${t}\n${m}`) : Alert.alert(t, m));

  const save = async () => {
    if (!user) return router.push("/login");
    setSaving(true);
    try {
      await api("/me/outfit", { method: "PUT", body: JSON.stringify(current) });
      notify("Tersimpan!", "Karaktermu sudah tampil di lobi utama.");
      goBack();
    } catch {
      notify("Gagal", "Pakaian belum tersimpan. Coba lagi.");
    }
    setSaving(false);
  };

  const upload = async (k: WItem["kind"]) => {
    const p = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (p.canceled || !p.assets[0]) return;
    const a = p.assets[0];
    setUploading(k);
    try {
      const token = await getToken();
      const res = await uploadForm(`${BACKEND}/api/admin/wardrobe`, {
        headers: { Authorization: `Bearer ${token}` },
        fields: { kind: k, name: a.fileName?.split(".")[0] || k },
        files: { image: { uri: a.uri, name: a.fileName || `${k}.png`, mimeType: a.mimeType || "image/png" } },
      });
      if (!res.ok) throw new Error(await res.text());
      load();
    } catch {
      notify("Upload gagal", "Gunakan PNG (latar transparan untuk pakaian).");
    }
    setUploading(null);
  };

  const remove = (it: WItem) => {
    const go = () => api(`/admin/wardrobe/${it.item_id}`, { method: "DELETE" }).then(load).catch(() => {});
    if (Platform.OS === "web") {
      if (window.confirm(`Hapus ${it.name}?`)) go();
    } else Alert.alert("Hapus item?", it.name, [{ text: "Batal", style: "cancel" }, { text: "Hapus", style: "destructive", onPress: go }]);
  };

  const Slot = ({ it, k, size }: { it?: WItem; k: WItem["kind"]; size: number }) => {
    if (!it) {
      return (
        <Pressable
          testID={`slot-empty-${k}`}
          disabled={!isAdmin || uploading !== null}
          onPress={() => upload(k)}
          style={[styles.slot, { width: size, height: size }]}
        >
          {isAdmin && (uploading === k ? <ActivityIndicator color={C.white} /> : <Ionicons name="add" size={26} color={C.white} />)}
        </Pressable>
      );
    }
    const on = current[FIELD[k]] === it.item_id;
    return (
      <Pressable
        testID={`slot-${k}-${it.item_id}`}
        onPress={() => pick(k, it.item_id)}
        onLongPress={isAdmin ? () => remove(it) : undefined}
        style={[styles.slot, { width: size, height: size }, on && styles.slotOn]}
      >
        <Image source={absoluteFileUrl(it.image_url)} style={styles.thumb} contentFit="contain" />
      </Pressable>
    );
  };

  const side = (k: "character", from: number) =>
    Array.from({ length: SIDE_SLOTS }).map((_, i) => <Slot key={i} it={of(k)[from + i]} k={k} size={78} />);

  return (
    <ImageBackground source={require("@/assets/bg/stadium.jpg")} style={styles.container} resizeMode="cover">
      <LinearGradient colors={["rgba(4,30,70,0.85)", "rgba(6,40,90,0.75)", "rgba(3,18,42,0.95)"]} style={StyleSheet.absoluteFill} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={goBack} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={26} color={C.white} />
        </Pressable>
        <Text style={styles.title}>DRESSING ROOM</Text>
        <Pressable testID="dressing-save" disabled={saving} onPress={save} style={styles.saveBtn}>
          {saving ? <ActivityIndicator color={C.white} /> : <Text style={styles.saveTxt}>SAVE</Text>}
        </Pressable>
      </View>

      {items === null ? (
        <ActivityIndicator color={C.cyan} style={{ marginTop: 80 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
          <View style={styles.stageRow}>
            <View style={styles.sideCol}>{side("character", 0)}</View>
            <GestureDetector gesture={pan}>
              <Animated.View testID="dressing-stage" style={[styles.stage, stageStyle]}>
                <CharacterStage items={items} outfit={current} back={back} />
              </Animated.View>
            </GestureDetector>
            <View style={styles.sideCol}>{side("character", SIDE_SLOTS)}</View>
          </View>
          <View style={styles.rotateRow}>
            <Pressable testID="rotate-left" onPress={() => spin(-45)} style={styles.rotBtn}>
              <Ionicons name="refresh" size={18} color={C.white} style={{ transform: [{ scaleX: -1 }] }} />
            </Pressable>
            <Text style={styles.rotHint}>Geser karakter untuk memutar</Text>
            <Pressable testID="rotate-right" onPress={() => spin(45)} style={styles.rotBtn}>
              <Ionicons name="refresh" size={18} color={C.white} />
            </Pressable>
          </View>

          {(["top", "bottom", "shoes"] as const).map((k) => (
            <View key={k} style={styles.panel}>
              <Text style={styles.rowLbl}>{k === "top" ? "BAJU" : k === "bottom" ? "CELANA" : "SEPATU"}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {Array.from({ length: Math.max(ROW_SLOTS, of(k).length + (isAdmin ? 1 : 0)) }).map((_, i) => (
                  <Slot key={i} it={of(k)[i]} k={k} size={74} />
                ))}
              </ScrollView>
            </View>
          ))}
          {isAdmin && (
            <Text style={styles.adminHint}>
              Admin: tekan kotak “+” untuk upload (karakter = foto seluruh badan, pakaian = PNG transparan). Tekan lama item untuk menghapus.
            </Text>
          )}
        </ScrollView>
      )}
    </ImageBackground>
  );
}

const glow = (c: string) => ({ shadowColor: c, shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6 });

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#031228" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: C.white, fontWeight: "900", fontStyle: "italic", fontSize: 18, letterSpacing: 1, textShadowColor: C.cyan, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 },
  saveBtn: { minWidth: 92, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 2, borderColor: C.orange, backgroundColor: "rgba(120,50,0,0.6)", alignItems: "center", justifyContent: "center", ...glow(C.orange) },
  saveTxt: { color: C.white, fontWeight: "900", fontSize: 18, letterSpacing: 1 },
  stageRow: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: spacing.sm, gap: spacing.xs },
  sideCol: { gap: spacing.sm, paddingTop: spacing.sm },
  stage: { flex: 1, height: 380 },
  rotateRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md, marginVertical: spacing.sm },
  rotBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: C.cyan, alignItems: "center", justifyContent: "center", backgroundColor: C.panel },
  rotHint: { color: "rgba(255,255,255,0.7)", fontSize: 11 },
  panel: { marginHorizontal: spacing.md, marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: C.panel, borderWidth: 1, borderColor: "rgba(54,200,255,0.35)", gap: 6 },
  rowLbl: { color: C.cyan, fontWeight: "900", fontSize: 11, letterSpacing: 2 },
  slot: { borderRadius: radius.sm, borderWidth: 2, borderColor: C.cyan, backgroundColor: C.slot, alignItems: "center", justifyContent: "center", overflow: "hidden", ...glow(C.cyan) },
  slotOn: { borderColor: C.orange, backgroundColor: "rgba(255,154,46,0.35)", ...glow(C.orange) },
  thumb: { width: "88%", height: "88%" },
  adminHint: { color: "rgba(255,255,255,0.7)", fontSize: 11, textAlign: "center", marginTop: spacing.md, paddingHorizontal: spacing.lg },
});
