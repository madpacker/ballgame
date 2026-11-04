import { View, Text, Pressable, StyleSheet, TextInput, ImageBackground, ActivityIndicator, Platform, Linking } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";

import { spacing, radius } from "@/src/theme";
import { api, getToken } from "@/src/api";
import { useAuth } from "@/src/contexts/auth";
import { uploadForm } from "@/src/utils/upload";
import BottomNav from "@/src/components/BottomNav";

// Fixed game-lobby palette (identical in every theme).
const C = { white: "#FFFFFF", gold: "#F2C24E", goldSoft: "#E9CF8A", glass: "rgba(8,16,40,0.82)", red: "#D7262E", muted: "#AEB9D6", green: "#3FCF8E" };
const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

type PS = { name: string; picture?: string | null; can_change_photo: boolean; next_photo_change_at?: string | null };

export default function ProfileSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const [ps, setPs] = useState<PS | null>(null);
  const [level, setLevel] = useState(1);
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [permBlocked, setPermBlocked] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!user) return;
    api<PS>("/me/profile-settings").then((r) => {
      setPs(r);
      setName(r.name);
    }).catch(() => {});
    api<{ level: number }>("/me/xp").then((r) => setLevel(r.level)).catch(() => {});
  }, [user]);

  const pickPhoto = async () => {
    setMsg(null);
    if (ps && !ps.can_change_photo) {
      setMsg({ ok: false, text: `Foto bisa diganti lagi pada ${new Date(ps.next_photo_change_at!).toLocaleDateString("id-ID")}.` });
      return;
    }
    if (Platform.OS !== "web") {
      const cur = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (!cur.granted) {
        if (!cur.canAskAgain) {
          setPermBlocked(true);
          return;
        }
        const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!req.granted) {
          setPermBlocked(!req.canAskAgain);
          setMsg({ ok: false, text: "Izin galeri diperlukan untuk memilih foto profil." });
          return;
        }
      }
    }
    setPermBlocked(false);
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!r.canceled && r.assets[0]) setPhoto(r.assets[0]);
  };

  const save = async () => {
    if (!user) return;
    const n = name.trim();
    if (n.length < 2) {
      setMsg({ ok: false, text: "Nama minimal 2 karakter." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      if (n !== ps?.name) await api("/me/profile", { method: "PUT", body: JSON.stringify({ name: n }) });
      if (photo) {
        const token = await getToken();
        const res = await uploadForm(`${BACKEND}/api/me/avatar`, {
          headers: { Authorization: `Bearer ${token}` },
          files: { image: { uri: photo.uri, name: photo.fileName || "avatar.jpg", mimeType: photo.mimeType || "image/jpeg" } },
        });
        if (!res.ok) throw new Error(await res.text());
        setPhoto(null);
      }
      await refreshUser();
      const fresh = await api<PS>("/me/profile-settings");
      setPs(fresh);
      setMsg({ ok: true, text: "Profil berhasil disimpan!" });
    } catch (e) {
      setMsg({ ok: false, text: String(e).includes("photo_cooldown") ? "Foto hanya bisa diganti sekali setiap 7 hari." : "Gagal menyimpan profil." });
    } finally {
      setSaving(false);
    }
  };

  const avatarSrc = photo?.uri || user?.picture;

  return (
    <ImageBackground source={require("@/assets/bg/stadium.jpg")} style={styles.container} resizeMode="cover">
      <LinearGradient colors={["rgba(10,40,110,0.55)", "rgba(7,22,55,0.85)", "rgba(7,22,55,0.98)"]} style={StyleSheet.absoluteFill} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} style={styles.sqBtn}>
          <Ionicons name="chevron-back" size={26} color={C.white} />
        </Pressable>
        <Text numberOfLines={1} style={styles.title}>PENGATURAN PROFIL</Text>
        <View style={styles.sqBtn}>
          <Ionicons name="settings-sharp" size={22} color={C.muted} />
        </View>
      </View>

      {!user ? (
        <View style={styles.center}>
          <Text style={styles.label}>Masuk dulu untuk mengatur profil.</Text>
          <Pressable testID="settings-login" onPress={() => router.push("/login")} style={styles.saveWrap}>
            <LinearGradient colors={["#F0434B", "#B3131B"]} style={styles.save}>
              <Text style={styles.saveTxt}>MASUK</Text>
            </LinearGradient>
          </Pressable>
        </View>
      ) : (
        <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={styles.avatarArea}>
            <Pressable testID="avatar-pick" onPress={pickPhoto} style={styles.ring}>
              {avatarSrc ? (
                <Image source={avatarSrc} style={styles.avatar} contentFit="cover" />
              ) : (
                <Ionicons name="person" size={90} color={C.white} />
              )}
            </Pressable>
            <View style={styles.lvl}>
              <Text style={styles.lvlSmall}>LVL</Text>
              <Text testID="settings-level" style={styles.lvlBig}>{level}</Text>
            </View>
            <Pressable testID="change-photo-button" onPress={pickPhoto} style={styles.camWrap}>
              <View style={styles.cam}>
                <Ionicons name="camera" size={26} color={C.gold} />
              </View>
              <Text style={styles.camTxt}>GANTI FOTO</Text>
            </Pressable>
          </View>
          <Text style={styles.avatarCaption}>Ubah Foto Profil</Text>
          {permBlocked && (
            <Pressable testID="open-settings" onPress={() => Linking.openSettings()} style={styles.permBtn}>
              <Text style={styles.permTxt}>Buka Pengaturan untuk izinkan galeri</Text>
            </Pressable>
          )}

          <Text style={styles.label}>NAMA PENGGUNA</Text>
          <Pressable onPress={() => inputRef.current?.focus()} style={styles.field}>
            <TextInput
              ref={inputRef}
              testID="name-input"
              value={name}
              onChangeText={setName}
              maxLength={30}
              placeholder="Nama kamu"
              placeholderTextColor={C.muted}
              style={styles.input}
            />
            <Ionicons name="pencil" size={20} color={C.gold} />
          </Pressable>

          {msg && <Text testID="settings-msg" style={[styles.msg, { color: msg.ok ? C.green : "#FF6B6B" }]}>{msg.text}</Text>}

          <Pressable testID="save-profile-button" disabled={saving} onPress={save} style={styles.saveWrap}>
            <LinearGradient colors={["#F0434B", "#B3131B"]} style={styles.save}>
              {saving ? (
                <ActivityIndicator color={C.white} />
              ) : (
                <Text style={styles.saveTxt}>
                  SETUJU & SIMPAN <Text style={{ color: C.gold }}>✔</Text>
                </Text>
              )}
            </LinearGradient>
          </Pressable>

          <View testID="photo-notice" style={styles.notice}>
            <View style={styles.infoIcon}>
              <Ionicons name="information" size={24} color={C.gold} />
            </View>
            <Text style={styles.noticeTxt}>
              <Text style={{ color: C.gold, fontWeight: "900" }}>PENTING: </Text>
              Anda hanya dapat mengubah foto profil sekali setiap 7 hari. Pastikan foto yang Anda unggah sudah sesuai dan tidak melanggar ketentuan.
            </Text>
          </View>
        </KeyboardAwareScrollView>
      )}
      <BottomNav active="profile" />
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#071637" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  sqBtn: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: C.glass, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: C.white, fontSize: 22, fontWeight: "900", fontStyle: "italic", textShadowColor: "#5FB4FF", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  avatarArea: { alignSelf: "center", marginTop: spacing.lg, width: 220, height: 230, alignItems: "center" },
  ring: {
    width: 210, height: 210, borderRadius: 105, borderWidth: 6, borderColor: C.gold, backgroundColor: "#EDEDED22",
    alignItems: "center", justifyContent: "center", overflow: "hidden",
    shadowColor: C.gold, shadowOpacity: 0.9, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 10,
  },
  avatar: { width: "100%", height: "100%" },
  lvl: {
    position: "absolute", bottom: 0, left: 60, width: 60, height: 60, borderRadius: 30, backgroundColor: "#13254F",
    borderWidth: 2, borderColor: C.gold, alignItems: "center", justifyContent: "center",
  },
  lvlSmall: { color: C.goldSoft, fontSize: 10, fontWeight: "900" },
  lvlBig: { color: C.white, fontSize: 20, fontWeight: "900", marginTop: -2 },
  camWrap: { position: "absolute", bottom: -12, right: -16, alignItems: "center" },
  cam: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.red, borderWidth: 2, borderColor: C.gold, alignItems: "center", justifyContent: "center" },
  camTxt: { color: C.white, fontWeight: "900", fontSize: 12, marginTop: 2 },
  avatarCaption: { alignSelf: "center", color: C.white, fontSize: 16, marginTop: spacing.md, backgroundColor: "rgba(0,0,0,0.35)", paddingHorizontal: spacing.lg, paddingVertical: 6, borderRadius: radius.md },
  permBtn: { alignSelf: "center", padding: spacing.sm },
  permTxt: { color: C.gold, fontWeight: "800", textDecorationLine: "underline" },
  label: { color: C.goldSoft, fontSize: 20, fontWeight: "900", marginTop: spacing.lg },
  field: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: C.glass, borderWidth: 1.5, borderColor: C.gold,
    borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 56,
  },
  input: { flex: 1, color: C.white, fontSize: 20, fontWeight: "700", paddingVertical: spacing.sm },
  msg: { fontSize: 13, fontWeight: "700", textAlign: "center" },
  saveWrap: {
    marginTop: spacing.lg, borderRadius: radius.md, shadowColor: "#F0434B", shadowOpacity: 0.7, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 8,
  },
  save: { borderRadius: radius.md, paddingVertical: 16, paddingHorizontal: spacing.xl, alignItems: "center", borderWidth: 2, borderColor: C.gold, minHeight: 56, justifyContent: "center" },
  saveTxt: { color: C.white, fontSize: 22, fontWeight: "900", fontStyle: "italic" },
  notice: { flexDirection: "row", gap: spacing.md, alignItems: "center", padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: C.gold, backgroundColor: C.glass, marginTop: spacing.md },
  infoIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.red, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: C.gold },
  noticeTxt: { flex: 1, color: C.white, fontSize: 13, lineHeight: 19 },
});
