import { View, Text, Pressable, StyleSheet, ScrollView, ImageBackground, ActivityIndicator, Platform, Alert, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useState } from "react";

import { spacing, radius } from "@/src/theme";
import { api, getToken } from "@/src/api";
import { useAuth } from "@/src/contexts/auth";
import { uploadForm } from "@/src/utils/upload";
import { absoluteFileUrl, useAppSettings } from "@/src/hooks/useAppSettings";
import CharacterStage, { type Outfit, type WItem } from "@/src/components/CharacterStage";

// Sci-fi locker palette (fixed in every theme).
const C = { cyan: "#36C8FF", orange: "#FF9A2E", white: "#FFFFFF", panel: "rgba(8,22,48,0.82)", slot: "rgba(30,110,180,0.35)" };
const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;
const SIDE_SLOTS = 3;
const HEADER_H = 60;

export default function DressingRoom() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height, width } = useWindowDimensions();
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [items, setItems] = useState<WItem[] | null>(null);
  const [outfit, setOutfit] = useState<Outfit>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [menu, setMenu] = useState<WItem | null>(null);
  const { settings, refresh: refreshSettings } = useAppSettings();

  const load = useCallback(() => {
    api<WItem[]>("/wardrobe").then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(() => {
    load();
    if (user) api<Outfit>("/me/outfit").then(setOutfit).catch(() => {});
  }, [load, user]);

  // Characters are full-body images, so the outfit is just the chosen character.
  const chars = (items ?? []).filter((i) => i.kind === "character");
  // A saved character that was deleted by admin falls back to the first one.
  const savedOk = chars.some((c) => c.item_id === outfit.character_id);
  const current: Outfit = { character_id: savedOk ? outfit.character_id : chars[0]?.item_id };

  const pick = (id: string) => {
    if (Platform.OS !== "web") void import("expo-haptics").then((h) => h.selectionAsync());
    setOutfit({ character_id: id });
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
      notify("Gagal", "Karakter belum tersimpan. Coba lagi.");
    }
    setSaving(false);
  };

  // Pick one image and send it to an admin endpoint. `busy` marks which slot shows the spinner.
  const sendImage = async (path: string, busy: string, fields: Record<string, string> = {}) => {
    const p = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (p.canceled || !p.assets[0]) return false;
    const a = p.assets[0];
    setUploading(busy);
    try {
      const token = await getToken();
      const res = await uploadForm(`${BACKEND}/api${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        fields: { ...fields, name: a.fileName?.split(".")[0] || "karakter" },
        files: { image: { uri: a.uri, name: a.fileName || "image.png", mimeType: a.mimeType || "image/png" } },
      });
      if (!res.ok) throw new Error(await res.text());
      return true;
    } catch {
      notify("Upload gagal", "Gunakan gambar PNG atau JPG.");
      return false;
    } finally {
      setUploading(null);
    }
  };

  const upload = async () => {
    if (await sendImage("/admin/wardrobe", "new", { kind: "character" })) load();
  };

  const remove = (it: WItem) => {
    setMenu(null);
    const go = () => api(`/admin/wardrobe/${it.item_id}`, { method: "DELETE" }).then(load).catch(() => {});
    if (Platform.OS === "web") {
      if (window.confirm(`Hapus ${it.name}?`)) go();
    } else Alert.alert("Hapus karakter?", it.name, [{ text: "Batal", style: "cancel" }, { text: "Hapus", style: "destructive", onPress: go }]);
  };

  const uploadMascot = async () => {
    if (await sendImage("/admin/app-settings/mascot", "mascot")) refreshSettings();
  };
  const clearMascot = () => api("/admin/app-settings/mascot", { method: "DELETE" }).then(refreshSettings).catch(() => {});

  const slotSize = Math.min(110, Math.round(width * 0.22));
  const Slot = ({ it }: { it?: WItem }) => {
    if (!it) {
      return (
        <Pressable
          testID="slot-empty-character"
          disabled={!isAdmin || uploading !== null}
          onPress={upload}
          style={[styles.slot, { width: slotSize, height: slotSize }]}
        >
          {isAdmin && (uploading === "new" ? <ActivityIndicator color={C.white} /> : <Ionicons name="add" size={40} color={C.white} />)}
        </Pressable>
      );
    }
    const on = current.character_id === it.item_id;
    return (
      <Pressable
        testID={`slot-character-${it.item_id}`}
        onPress={() => pick(it.item_id)}
        onLongPress={isAdmin ? () => setMenu(it) : undefined}
        style={[styles.slot, { width: slotSize, height: slotSize }, on && styles.slotOn]}
      >
        <Image source={absoluteFileUrl(it.image_url)} style={styles.thumb} contentFit="contain" />
      </Pressable>
    );
  };

  const side = (from: number) => Array.from({ length: SIDE_SLOTS }).map((_, i) => <Slot key={i} it={chars[from + i]} />);
  const stageH = height - insets.top - insets.bottom - HEADER_H - spacing.md;

  return (
    <ImageBackground source={require("@/assets/bg/stadium.jpg")} style={styles.container} resizeMode="cover">
      <LinearGradient colors={["rgba(4,30,70,0.80)", "rgba(6,40,90,0.65)", "rgba(3,18,42,0.92)"]} style={StyleSheet.absoluteFill} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={goBack} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={30} color={C.white} />
        </Pressable>
        <Text style={styles.title}>DRESSING ROOM</Text>
        <Pressable testID="dressing-save" disabled={saving} onPress={save} style={styles.saveBtn}>
          {saving ? <ActivityIndicator color={C.white} /> : <Text style={styles.saveTxt}>SAVE</Text>}
        </Pressable>
      </View>

      {items === null ? (
        <ActivityIndicator color={C.cyan} style={{ marginTop: 80 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }} showsVerticalScrollIndicator={false}>
          {/* Big character in the middle with selectable character slots on both sides */}
          <View style={[styles.stageWrap, { height: stageH }]}>
            <View testID="dressing-stage" style={styles.stage}>
              <CharacterStage items={items} outfit={current} />
            </View>
            <View style={[styles.sideCol, { left: 0 }]}>{side(0)}</View>
            <View style={[styles.sideCol, { right: 0 }]}>{side(SIDE_SLOTS)}</View>
          </View>

          {isAdmin && (
            <View style={styles.panel} testID="mascot-admin">
              <Text style={styles.rowLbl}>MASKOT LOBI (ADMIN)</Text>
              <View style={styles.mascotRow}>
                <View style={[styles.slot, { width: 74, height: 74 }]}>
                  {uploading === "mascot" ? (
                    <ActivityIndicator color={C.white} />
                  ) : settings.mascot_url ? (
                    <Image source={absoluteFileUrl(settings.mascot_url)} style={styles.thumb} contentFit="contain" />
                  ) : (
                    <Ionicons name="body" size={34} color={C.white} />
                  )}
                </View>
                <View style={{ flex: 1, gap: spacing.sm }}>
                  <Text style={styles.mascotTxt}>Tampil di layar utama untuk pemain yang belum memilih karakter.</Text>
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <Pressable testID="mascot-upload" disabled={uploading !== null} onPress={uploadMascot} style={styles.adminBtn}>
                      <Text style={styles.adminBtnTxt}>{settings.mascot_url ? "GANTI" : "UPLOAD"}</Text>
                    </Pressable>
                    {settings.mascot_url ? (
                      <Pressable testID="mascot-delete" onPress={clearMascot} style={[styles.adminBtn, styles.adminBtnDanger]}>
                        <Text style={styles.adminBtnTxt}>HAPUS</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>
              <Text style={styles.adminHint}>Tekan kotak “+” untuk upload karakter (gambar seluruh badan). Tekan lama karakter untuk menghapus.</Text>
            </View>
          )}
        </ScrollView>
      )}

      {menu && (
        <Pressable style={styles.overlay} onPress={() => setMenu(null)} testID="item-menu">
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{menu.name}</Text>
            <Pressable testID="menu-delete" style={styles.sheetBtn} onPress={() => remove(menu)}>
              <Ionicons name="trash" size={18} color={C.orange} />
              <Text style={[styles.sheetTxt, { color: C.orange }]}>Hapus karakter</Text>
            </Pressable>
            <Pressable testID="menu-cancel" style={styles.sheetBtn} onPress={() => setMenu(null)}>
              <Text style={[styles.sheetTxt, { opacity: 0.7 }]}>Batal</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}
    </ImageBackground>
  );
}

const glow = (c: string) => ({ shadowColor: c, shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6 });

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#031228" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, minHeight: HEADER_H },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: C.white, fontWeight: "900", fontStyle: "italic", fontSize: 22, letterSpacing: 1, textShadowColor: C.cyan, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 },
  saveBtn: { minWidth: 92, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 2, borderColor: C.orange, backgroundColor: "rgba(120,50,0,0.6)", alignItems: "center", justifyContent: "center", ...glow(C.orange) },
  saveTxt: { color: C.white, fontWeight: "900", fontSize: 20, letterSpacing: 1 },
  stageWrap: { marginTop: spacing.sm },
  stage: { flex: 1, marginHorizontal: "20%" },
  sideCol: { position: "absolute", top: spacing.md, gap: spacing.md, paddingHorizontal: spacing.xs },
  panel: { marginHorizontal: spacing.md, marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: C.panel, borderWidth: 1, borderColor: "rgba(54,200,255,0.35)", gap: 6 },
  rowLbl: { color: C.cyan, fontWeight: "900", fontSize: 11, letterSpacing: 2 },
  slot: { borderRadius: radius.md, borderWidth: 2, borderColor: C.cyan, backgroundColor: C.slot, alignItems: "center", justifyContent: "center", overflow: "hidden", ...glow(C.cyan) },
  slotOn: { borderColor: C.orange, backgroundColor: "rgba(255,154,46,0.35)", ...glow(C.orange) },
  thumb: { width: "88%", height: "88%" },
  mascotRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  mascotTxt: { color: "rgba(255,255,255,0.8)", fontSize: 12 },
  adminBtn: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: C.cyan, alignItems: "center", justifyContent: "center" },
  adminBtnDanger: { borderColor: C.orange },
  adminBtnTxt: { color: C.white, fontWeight: "900", fontSize: 12, letterSpacing: 1 },
  adminHint: { color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: spacing.xs },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#071a38", borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, paddingBottom: spacing.xl, borderTopWidth: 2, borderColor: C.cyan },
  sheetTitle: { color: C.white, fontWeight: "900", fontSize: 15, marginBottom: spacing.sm, textAlign: "center" },
  sheetBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.sm },
  sheetTxt: { color: C.white, fontSize: 14, fontWeight: "700" },
});
