import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useEffect, useState } from "react";
import * as Haptics from "expo-haptics";

import { colors, radius, spacing } from "@/src/theme";
import { useAuth } from "@/src/contexts/auth";
import { api, getToken } from "@/src/api";
import { uploadForm } from "@/src/utils/upload";
import TournamentAdmin from "@/src/components/TournamentAdmin";
import { absolutePhotoUrl, type ApiPlayer } from "@/src/data/questions";
import { absoluteFileUrl, useAppSettings } from "@/src/hooks/useAppSettings";

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;
const POSITIONS: ("GK" | "DEF" | "MID" | "FWD")[] = ["GK", "DEF", "MID", "FWD"];

type AdminMatch = {
  match_id: string;
  opponent: string;
  kickoff_at: string;
  home: boolean;
  final_home?: number | null;
  final_away?: number | null;
  status: "upcoming" | "live" | "finished";
};

type AdminNews = {
  news_id: string;
  title: string;
  excerpt?: string | null;
  cover_url?: string | null;
  created_at: string;
};

type AdminQuizItem = {
  item_id: string;
  category: "trivia" | "garuda";
  prompt: string;
  image_url?: string | null;
  options: string[];
  answer_index: number;
  active: boolean;
  order_index: number;
};

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [name, setName] = useState("");
  const [position, setPosition] = useState<"GK" | "DEF" | "MID" | "FWD">("MID");
  const [years, setYears] = useState("");
  const [prevClubs, setPrevClubs] = useState("");
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; txt: string } | null>(null);
  const [players, setPlayers] = useState<ApiPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [matches, setMatches] = useState<AdminMatch[]>([]);
  const [mOpp, setMOpp] = useState("");
  const [mDate, setMDate] = useState("");
  const [mHome, setMHome] = useState(true);
  const [mSubmitting, setMSubmitting] = useState(false);
  const [resultOpen, setResultOpen] = useState<string | null>(null);
  const [resH, setResH] = useState("");
  const [resA, setResA] = useState("");
  const [resScorerIds, setResScorerIds] = useState<string[]>([]);
  const [resMotmId, setResMotmId] = useState<string | null>(null);

  // Background / socials / description
  const { settings, refresh: refreshSettings } = useAppSettings();
  const [bgPhoto, setBgPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [bgSubmitting, setBgSubmitting] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [igDraft, setIgDraft] = useState("");
  const [tkDraft, setTkDraft] = useState("");
  const [waDraft, setWaDraft] = useState("");
  const [ytDraft, setYtDraft] = useState("");
  const [infoSaving, setInfoSaving] = useState(false);

  // News
  const [news, setNews] = useState<AdminNews[]>([]);
  const [newsTitle, setNewsTitle] = useState("");
  const [newsBody, setNewsBody] = useState("");
  const [newsCover, setNewsCover] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [newsSubmitting, setNewsSubmitting] = useState(false);

  // Quiz Items (Trivia & Garuda Call)
  const [quizCat, setQuizCat] = useState<"trivia" | "garuda">("trivia");
  const [quizItems, setQuizItems] = useState<AdminQuizItem[]>([]);
  const [qiPrompt, setQiPrompt] = useState("");
  const [qiOptions, setQiOptions] = useState<string[]>(["", "", "", ""]);
  const [qiAnswer, setQiAnswer] = useState(0);
  const [qiImage, setQiImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [qiSubmitting, setQiSubmitting] = useState(false);
  const [qiEditId, setQiEditId] = useState<string | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);

  useEffect(() => {
    setDescDraft(settings.description ?? "");
    setIgDraft(settings.socials?.instagram ?? "");
    setTkDraft(settings.socials?.tiktok ?? "");
    setWaDraft(settings.socials?.whatsapp ?? "");
    setYtDraft(settings.socials?.youtube ?? "");
  }, [settings]);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await api<ApiPlayer[]>("/players?include_all=true");
      setPlayers(list);
    } catch {
      setPlayers([]);
    } finally {
      setLoading(false);
    }
    try {
      const ms = await api<AdminMatch[]>("/matches");
      setMatches(ms);
    } catch {
      setMatches([]);
    }
    try {
      const ns = await api<AdminNews[]>("/news");
      setNews(ns);
    } catch {
      setNews([]);
    }
    try {
      const qi = await api<AdminQuizItem[]>(`/admin/quiz-items?category=${quizCat}`);
      setQuizItems(qi);
    } catch {
      setQuizItems([]);
    }
  };

  useEffect(() => {
    if (user?.is_admin) refresh();
    else setLoading(false);
  }, [user]);

  // Reload quiz-items only when user switches between Trivia / Garuda tab.
  useEffect(() => {
    if (!user?.is_admin) return;
    (async () => {
      try {
        const qi = await api<AdminQuizItem[]>(`/admin/quiz-items?category=${quizCat}`);
        setQuizItems(qi);
      } catch {
        setQuizItems([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizCat]);

  if (!user) {
    return (
      <GateView
        router={router}
        insets={insets}
        icon="shield-outline"
        title="Masuk sebagai admin"
        body="Fitur ini hanya untuk admin. Silakan login dulu."
        action={() => router.push("/login")}
        actionLabel="LANJUT DENGAN GOOGLE"
      />
    );
  }
  if (!user.is_admin) {
    return (
      <GateView
        router={router}
        insets={insets}
        icon="lock-closed"
        title="Khusus admin"
        body="Akun kamu belum punya akses admin. Admin pertama adalah user yang mendaftar paling awal."
        action={() => router.replace("/")}
        actionLabel="KEMBALI KE BERANDA"
      />
    );
  }

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setMsg({ kind: "err", txt: "Izin galeri ditolak." });
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.75,
      allowsEditing: true,
      aspect: [4, 5],
    });
    if (!r.canceled && r.assets[0]) setPhoto(r.assets[0]);
  };

  const submit = async () => {
    if (!name.trim()) {
      setMsg({ kind: "err", txt: "Nama pemain wajib diisi." });
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const token = await getToken();
      const files = photo
        ? {
            photo: {
              uri: photo.uri,
              name: photo.fileName || `${Date.now()}.jpg`,
              mimeType: photo.mimeType || "image/jpeg",
            },
          }
        : {};
      const res = await uploadForm(`${BACKEND}/api/admin/players`, {
        headers: { Authorization: `Bearer ${token}` },
        fields: {
          name: name.trim(),
          position,
          years_at_mu: years.trim(),
          previous_clubs: prevClubs.trim(),
          included_in_quiz: "true",
        },
        files: files as any,
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg({ kind: "ok", txt: "Pemain ditambahkan!" });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setName("");
      setYears("");
      setPrevClubs("");
      setPhoto(null);
      refresh();
    } catch (e: any) {
      setMsg({ kind: "err", txt: "Gagal menyimpan pemain." });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleQuiz = async (p: ApiPlayer) => {
    try {
      await api(
        `/admin/players/${p.player_id}?included_in_quiz=${!p.included_in_quiz}`,
        { method: "PATCH" },
      );
      refresh();
    } catch {}
  };

  const remove = async (p: ApiPlayer) => {
    try {
      await api(`/admin/players/${p.player_id}`, { method: "DELETE" });
      refresh();
    } catch {}
  };

  const seedDemo = async () => {
    setSeeding(true);
    try {
      const r = await api<{ inserted: number; total: number }>("/admin/seed-players", { method: "POST" });
      setMsg({ kind: "ok", txt: `+${r.inserted} pemain demo (total ${r.total}).` });
      refresh();
    } catch {
      setMsg({ kind: "err", txt: "Gagal seed." });
    } finally {
      setSeeding(false);
    }
  };

  const createMatch = async () => {
    if (!mOpp.trim() || !mDate.trim()) {
      setMsg({ kind: "err", txt: "Lawan dan tanggal wajib." });
      return;
    }
    // Expect YYYY-MM-DDTHH:MM format in local time (treated as WIB → shift to UTC)
    const dt = new Date(mDate);
    if (isNaN(dt.getTime())) {
      setMsg({ kind: "err", txt: "Format tanggal salah. Contoh: 2026-02-20T19:00" });
      return;
    }
    setMSubmitting(true);
    try {
      await api("/admin/matches", {
        method: "POST",
        body: JSON.stringify({
          opponent: mOpp.trim(),
          kickoff_at: dt.toISOString(),
          home: mHome,
          competition: "Liga 1",
        }),
      });
      setMsg({ kind: "ok", txt: "Jadwal tersimpan." });
      setMOpp("");
      setMDate("");
      refresh();
    } catch {
      setMsg({ kind: "err", txt: "Gagal buat jadwal." });
    } finally {
      setMSubmitting(false);
    }
  };

  const submitResult = async () => {
    if (!resultOpen) return;
    const h = parseInt(resH, 10);
    const a = parseInt(resA, 10);
    if (isNaN(h) || isNaN(a)) return;
    try {
      await api(`/admin/matches/${resultOpen}/result`, {
        method: "POST",
        body: JSON.stringify({
          final_home: h,
          final_away: a,
          scorer_player_ids: resScorerIds,
          motm_player_id: resMotmId,
        }),
      });
      setMsg({ kind: "ok", txt: "Hasil tersimpan. Prediksi dinilai otomatis." });
      setResultOpen(null);
      setResH("");
      setResA("");
      setResScorerIds([]);
      setResMotmId(null);
      refresh();
    } catch {
      setMsg({ kind: "err", txt: "Gagal simpan hasil." });
    }
  };

  const toggleScorer = (id: string) => {
    setResScorerIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  };

  const deleteMatch = async (id: string) => {
    try {
      await api(`/admin/matches/${id}`, { method: "DELETE" });
      refresh();
    } catch {}
  };

  // ---- Background ----
  const pickBg = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setMsg({ kind: "err", txt: "Izin galeri ditolak." });
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: true,
      aspect: [16, 9],
    });
    if (!r.canceled && r.assets[0]) setBgPhoto(r.assets[0]);
  };

  const uploadBg = async () => {
    if (!bgPhoto) {
      setMsg({ kind: "err", txt: "Pilih foto background dulu." });
      return;
    }
    setBgSubmitting(true);
    try {
      const token = await getToken();
      const res = await uploadForm(`${BACKEND}/api/admin/app-settings/background`, {
        headers: { Authorization: `Bearer ${token}` },
        files: {
          image: {
            uri: bgPhoto.uri,
            name: bgPhoto.fileName || `bg_${Date.now()}.jpg`,
            mimeType: bgPhoto.mimeType || "image/jpeg",
          },
        } as any,
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg({ kind: "ok", txt: "Background diperbarui." });
      setBgPhoto(null);
      await refreshSettings();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setMsg({ kind: "err", txt: "Gagal upload background." });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBgSubmitting(false);
    }
  };

  const clearBg = async () => {
    try {
      await api("/admin/app-settings/background", { method: "DELETE" });
      await refreshSettings();
      setMsg({ kind: "ok", txt: "Background dikembalikan ke default." });
    } catch {
      setMsg({ kind: "err", txt: "Gagal hapus background." });
    }
  };

  // ---- Socials & description ----
  const saveInfo = async () => {
    setInfoSaving(true);
    try {
      await api("/admin/app-settings", {
        method: "PUT",
        body: JSON.stringify({
          description: descDraft.trim(),
          socials: {
            instagram: igDraft.trim(),
            tiktok: tkDraft.trim(),
            whatsapp: waDraft.trim(),
            youtube: ytDraft.trim(),
          },
        }),
      });
      await refreshSettings();
      setMsg({ kind: "ok", txt: "Info admin tersimpan." });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setMsg({ kind: "err", txt: "Gagal simpan info admin." });
    } finally {
      setInfoSaving(false);
    }
  };

  // ---- News ----
  const pickNewsCover = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setMsg({ kind: "err", txt: "Izin galeri ditolak." });
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: true,
      aspect: [16, 9],
    });
    if (!r.canceled && r.assets[0]) setNewsCover(r.assets[0]);
  };

  const submitNews = async () => {
    if (!newsTitle.trim() || !newsBody.trim()) {
      setMsg({ kind: "err", txt: "Judul dan isi berita wajib." });
      return;
    }
    setNewsSubmitting(true);
    try {
      const token = await getToken();
      const files = newsCover
        ? {
            cover: {
              uri: newsCover.uri,
              name: newsCover.fileName || `cover_${Date.now()}.jpg`,
              mimeType: newsCover.mimeType || "image/jpeg",
            },
          }
        : {};
      const res = await uploadForm(`${BACKEND}/api/admin/news`, {
        headers: { Authorization: `Bearer ${token}` },
        fields: {
          title: newsTitle.trim(),
          body: newsBody.trim(),
        },
        files: files as any,
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg({ kind: "ok", txt: "Berita terbit!" });
      setNewsTitle("");
      setNewsBody("");
      setNewsCover(null);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refresh();
    } catch {
      setMsg({ kind: "err", txt: "Gagal menerbitkan berita." });
    } finally {
      setNewsSubmitting(false);
    }
  };

  const deleteNews = async (id: string) => {
    try {
      await api(`/admin/news/${id}`, { method: "DELETE" });
      refresh();
    } catch {}
  };

  // ---- Quiz Items (Trivia & Garuda) ----
  const resetQiForm = () => {
    setQiEditId(null);
    setQiPrompt("");
    setQiOptions(["", "", "", ""]);
    setQiAnswer(0);
    setQiImage(null);
  };

  const pickQiImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setMsg({ kind: "err", txt: "Izin galeri ditolak." });
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!r.canceled && r.assets[0]) setQiImage(r.assets[0]);
  };

  const startEditQi = (item: AdminQuizItem) => {
    setQiEditId(item.item_id);
    setQiPrompt(item.prompt);
    setQiOptions([
      item.options[0] || "",
      item.options[1] || "",
      item.options[2] || "",
      item.options[3] || "",
    ]);
    setQiAnswer(item.answer_index);
    setQiImage(null);
  };

  const submitQi = async () => {
    const prompt = qiPrompt.trim();
    const opts = qiOptions.map((o) => o.trim());
    if (!prompt) {
      setMsg({ kind: "err", txt: "Isi pertanyaan dulu." });
      return;
    }
    if (opts.some((o) => !o)) {
      setMsg({ kind: "err", txt: "Isi semua 4 pilihan jawaban." });
      return;
    }
    setQiSubmitting(true);
    try {
      const token = await getToken();
      if (qiEditId) {
        // Update existing: send JSON for text; multipart separately for image.
        await api(`/admin/quiz-items/${qiEditId}`, {
          method: "PUT",
          body: JSON.stringify({
            prompt,
            options: opts,
            answer_index: qiAnswer,
          }),
        });
        if (qiImage) {
          const res = await uploadForm(
            `${BACKEND}/api/admin/quiz-items/${qiEditId}/image`,
            {
              headers: { Authorization: `Bearer ${token}` },
              files: {
                image: {
                  uri: qiImage.uri,
                  name: qiImage.fileName || `qi_${Date.now()}.jpg`,
                  mimeType: qiImage.mimeType || "image/jpeg",
                },
              } as any,
            },
          );
          if (!res.ok) throw new Error(await res.text());
        }
        setMsg({ kind: "ok", txt: "Soal diperbarui." });
      } else {
        const files = qiImage
          ? {
              image: {
                uri: qiImage.uri,
                name: qiImage.fileName || `qi_${Date.now()}.jpg`,
                mimeType: qiImage.mimeType || "image/jpeg",
              },
            }
          : {};
        const res = await uploadForm(`${BACKEND}/api/admin/quiz-items`, {
          headers: { Authorization: `Bearer ${token}` },
          fields: {
            category: quizCat,
            prompt,
            option_a: opts[0],
            option_b: opts[1],
            option_c: opts[2],
            option_d: opts[3],
            answer_index: String(qiAnswer),
            active: "true",
          },
          files: files as any,
        });
        if (!res.ok) throw new Error(await res.text());
        setMsg({ kind: "ok", txt: "Soal baru ditambahkan." });
      }
      resetQiForm();
      // Reload list for current category.
      const qi = await api<AdminQuizItem[]>(`/admin/quiz-items?category=${quizCat}`);
      setQuizItems(qi);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setMsg({ kind: "err", txt: "Gagal menyimpan soal." });
    } finally {
      setQiSubmitting(false);
    }
  };

  const toggleQi = async (item: AdminQuizItem) => {
    try {
      const updated = await api<AdminQuizItem>(
        `/admin/quiz-items/${item.item_id}`,
        {
          method: "PUT",
          body: JSON.stringify({ active: !item.active }),
        },
      );
      setQuizItems((prev) =>
        prev.map((x) => (x.item_id === item.item_id ? updated : x)),
      );
    } catch {
      setMsg({ kind: "err", txt: "Gagal mengubah status soal." });
    }
  };

  const deleteQi = async (id: string) => {
    try {
      await api(`/admin/quiz-items/${id}`, { method: "DELETE" });
      setQuizItems((prev) => prev.filter((x) => x.item_id !== id));
      if (qiEditId === id) resetQiForm();
    } catch {}
  };

  const moveQi = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= quizItems.length) return;
    const next = [...quizItems];
    [next[index], next[target]] = [next[target], next[index]];
    // Reassign order_index on the client immediately for snappy UX.
    const reordered = next.map((it, i) => ({ ...it, order_index: i }));
    setQuizItems(reordered);
    try {
      await api("/admin/quiz-items/reorder", {
        method: "POST",
        body: JSON.stringify({
          category: quizCat,
          item_ids: reordered.map((x) => x.item_id),
        }),
      });
    } catch {
      // Rollback on failure.
      setQuizItems(quizItems);
      setMsg({ kind: "err", txt: "Gagal mengubah urutan soal." });
    }
  };

  const importCsv = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/csv", "*/*"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      setCsvBusy(true);
      const token = await getToken();
      const res = await uploadForm(`${BACKEND}/api/admin/quiz-items/import`, {
        headers: { Authorization: `Bearer ${token}` },
        fields: { category: quizCat },
        files: {
          file: {
            uri: asset.uri,
            name: asset.name || "soal.csv",
            mimeType: asset.mimeType || "text/csv",
          },
        } as any,
      });
      if (!res.ok) {
        const err = await res.text();
        setMsg({ kind: "err", txt: `Impor gagal: ${err.slice(0, 120)}` });
        return;
      }
      const data: { created: number; skipped: number; errors: string[] } =
        await res.json();
      setMsg({
        kind: data.created > 0 ? "ok" : "err",
        txt: `Impor selesai: ${data.created} dibuat, ${data.skipped} dilewati.${
          data.errors?.length ? ` Masalah: ${data.errors.slice(0, 2).join("; ")}` : ""
        }`,
      });
      // Reload list.
      const qi = await api<AdminQuizItem[]>(`/admin/quiz-items?category=${quizCat}`);
      setQuizItems(qi);
      if (Platform.OS !== "web")
        Haptics.notificationAsync(
          data.created > 0
            ? Haptics.NotificationFeedbackType.Success
            : Haptics.NotificationFeedbackType.Warning,
        ).catch(() => {});
    } catch {
      setMsg({ kind: "err", txt: "Impor CSV gagal." });
    } finally {
      setCsvBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTag}>ADMIN</Text>
          <Text style={styles.headerTitle}>DATABASE PEMAIN</Text>
        </View>
        <View style={styles.adminBadge}>
          <Ionicons name="shield-checkmark" size={14} color={colors.onBrandSecondary} />
          <Text style={styles.adminBadgeTxt}>ADMIN</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 60, gap: spacing.lg }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TournamentAdmin />

        <View style={styles.formCard}>
          <Text style={styles.sectionLabel}>TAMBAH PEMAIN BARU</Text>

          <Pressable testID="pick-photo-button" onPress={pickPhoto} style={styles.photoPicker}>
            {photo ? (
              <Image source={photo.uri} style={styles.photoPreview} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons name="camera" size={32} color={colors.muted} />
                <Text style={styles.photoHint}>Pilih foto pemain</Text>
              </View>
            )}
          </Pressable>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Nama Lengkap</Text>
            <TextInput
              testID="player-name-input"
              value={name}
              onChangeText={setName}
              placeholder="Nama pemain"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Posisi</Text>
            <View style={styles.posRow}>
              {POSITIONS.map((p) => {
                const active = p === position;
                return (
                  <Pressable
                    key={p}
                    testID={`position-${p}`}
                    onPress={() => setPosition(p)}
                    style={[styles.posChip, active && styles.posChipActive]}
                  >
                    <Text style={[styles.posTxt, active && styles.posTxtActive]}>{p}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Tahun di Madura United</Text>
            <TextInput
              testID="years-input"
              value={years}
              onChangeText={setYears}
              placeholder="mis. 2017-2020"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Klub-klub Sebelumnya</Text>
            <TextInput
              testID="prev-clubs-input"
              value={prevClubs}
              onChangeText={setPrevClubs}
              placeholder="pisah dengan koma: Arema, Persija, PSS"
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.input, { minHeight: 72, textAlignVertical: "top" }]}
            />
          </View>

          {msg && (
            <Text style={[styles.msg, msg.kind === "err" ? styles.msgErr : styles.msgOk]}>{msg.txt}</Text>
          )}

          <Pressable
            testID="submit-player-button"
            onPress={submit}
            disabled={submitting}
            style={[styles.cta, submitting && { opacity: 0.5 }]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <>
                <Ionicons name="save" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.ctaTxt}>SIMPAN PEMAIN</Text>
              </>
            )}
          </Pressable>
        </View>

        <View>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>SEMUA PEMAIN · {players.length}</Text>
            <Pressable
              testID="seed-demo-button"
              onPress={seedDemo}
              disabled={seeding}
              style={[styles.seedBtn, seeding && { opacity: 0.5 }]}
            >
              {seeding ? (
                <ActivityIndicator size="small" color={colors.onBrandSecondary} />
              ) : (
                <>
                  <Ionicons name="sparkles" size={14} color={colors.onBrandSecondary} />
                  <Text style={styles.seedTxt}>SEED DEMO</Text>
                </>
              )}
            </Pressable>
          </View>
          {loading && <ActivityIndicator color={colors.brandPrimary} />}
          {!loading && players.length === 0 && (
            <Text style={styles.muted}>Belum ada pemain. Tambahkan di atas.</Text>
          )}
          {players.map((p) => (
            <View key={p.player_id} style={styles.playerRow}>
              {p.photo_url ? (
                <Image source={absolutePhotoUrl(p.photo_url)} style={styles.playerAvatar} />
              ) : (
                <View style={[styles.playerAvatar, styles.playerAvatarFallback]}>
                  <Ionicons name="person" size={18} color={colors.muted} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.playerName}>{p.name}</Text>
                <Text style={styles.playerMeta}>
                  {p.position} · {p.years_at_mu || "–"} · {p.previous_clubs.length} klub
                </Text>
              </View>
              <Pressable
                testID={`toggle-${p.player_id}`}
                onPress={() => toggleQuiz(p)}
                hitSlop={8}
                style={[styles.toggle, p.included_in_quiz ? styles.toggleOn : styles.toggleOff]}
              >
                <Ionicons
                  name={p.included_in_quiz ? "checkmark" : "pause"}
                  size={14}
                  color={p.included_in_quiz ? colors.onSuccess : colors.muted}
                />
              </Pressable>
              <Pressable testID={`delete-${p.player_id}`} onPress={() => remove(p)} hitSlop={8}>
                <Ionicons name="trash" size={20} color={colors.error} />
              </Pressable>
            </View>
          ))}
        </View>

        {/* MATCHES ADMIN */}
        <View style={styles.formCard}>
          <Text style={styles.sectionLabel}>JADWAL PERTANDINGAN</Text>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Lawan</Text>
            <TextInput
              testID="match-opponent"
              value={mOpp}
              onChangeText={setMOpp}
              placeholder="mis. Persija Jakarta"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Tanggal & Jam (WIB)</Text>
            <TextInput
              testID="match-date"
              value={mDate}
              onChangeText={setMDate}
              placeholder="2026-02-20T19:00"
              placeholderTextColor={colors.muted}
              style={styles.input}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Kandang / Tandang</Text>
            <View style={styles.posRow}>
              <Pressable
                testID="match-home"
                onPress={() => setMHome(true)}
                style={[styles.posChip, mHome && styles.posChipActive]}
              >
                <Text style={[styles.posTxt, mHome && styles.posTxtActive]}>HOME</Text>
              </Pressable>
              <Pressable
                testID="match-away"
                onPress={() => setMHome(false)}
                style={[styles.posChip, !mHome && styles.posChipActive]}
              >
                <Text style={[styles.posTxt, !mHome && styles.posTxtActive]}>AWAY</Text>
              </Pressable>
            </View>
          </View>
          <Pressable
            testID="submit-match-button"
            onPress={createMatch}
            disabled={mSubmitting}
            style={[styles.cta, mSubmitting && { opacity: 0.5 }]}
          >
            {mSubmitting ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <>
                <Ionicons name="calendar" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.ctaTxt}>TAMBAH JADWAL</Text>
              </>
            )}
          </Pressable>
        </View>

        <View>
          <Text style={styles.sectionLabel}>DAFTAR LAGA · {matches.length}</Text>
          {matches.length === 0 && <Text style={styles.muted}>Belum ada jadwal.</Text>}
          {matches.map((m) => {
            const dt = new Date(m.kickoff_at);
            return (
              <View key={m.match_id} style={styles.playerRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.playerName}>
                    {m.home ? "MU vs " + m.opponent : m.opponent + " vs MU"}
                  </Text>
                  <Text style={styles.playerMeta}>
                    {m.status.toUpperCase()} · {dt.toLocaleDateString("id-ID")} {dt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                    {m.final_home != null && ` · ${m.final_home}-${m.final_away}`}
                  </Text>
                </View>
                {m.status !== "finished" && m.final_home == null && (
                  <Pressable testID={`set-result-${m.match_id}`} onPress={() => setResultOpen(m.match_id)} hitSlop={8}>
                    <Ionicons name="flag" size={20} color={colors.brandSecondary} />
                  </Pressable>
                )}
                <Pressable testID={`delete-match-${m.match_id}`} onPress={() => deleteMatch(m.match_id)} hitSlop={8}>
                  <Ionicons name="trash" size={20} color={colors.error} />
                </Pressable>
              </View>
            );
          })}
        </View>

        {/* BACKGROUND */}
        <View style={styles.formCard}>
          <Text style={styles.sectionLabel}>BACKGROUND APLIKASI</Text>
          <Pressable testID="pick-bg-button" onPress={pickBg} style={styles.photoPicker}>
            {bgPhoto ? (
              <Image source={bgPhoto.uri} style={styles.photoPreview} />
            ) : settings.background_url ? (
              <Image source={absoluteFileUrl(settings.background_url) || ""} style={styles.photoPreview} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons name="image" size={32} color={colors.muted} />
                <Text style={styles.photoHint}>Pilih gambar background (16:9)</Text>
              </View>
            )}
          </Pressable>
          <Text style={styles.helpText}>
            Background ini akan tampil di halaman utama dan quiz untuk semua pengguna.
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm as number }}>
            <Pressable
              testID="upload-bg-button"
              onPress={uploadBg}
              disabled={!bgPhoto || bgSubmitting}
              style={[styles.cta, { flex: 1 }, (!bgPhoto || bgSubmitting) && { opacity: 0.5 }]}
            >
              {bgSubmitting ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <>
                  <Ionicons name="cloud-upload" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.ctaTxt}>UPLOAD</Text>
                </>
              )}
            </Pressable>
            {settings.background_url && (
              <Pressable
                testID="clear-bg-button"
                onPress={clearBg}
                style={[styles.ctaSecondary, { flex: 1 }]}
              >
                <Ionicons name="trash-outline" size={16} color={colors.error} />
                <Text style={styles.ctaSecondaryTxt}>RESET</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* ADMIN INFO & SOCIALS */}
        <View style={styles.formCard}>
          <Text style={styles.sectionLabel}>INFO & MEDIA SOSIAL ADMIN</Text>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Deskripsi (ditampilkan di Berita & Profil)</Text>
            <TextInput
              testID="desc-input"
              value={descDraft}
              onChangeText={setDescDraft}
              placeholder="mis. Admin resmi Cak Mad Quiz, update harian Madura United."
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.input, { minHeight: 72, textAlignVertical: "top" }]}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Instagram (username atau URL)</Text>
            <TextInput
              testID="ig-input"
              value={igDraft}
              onChangeText={setIgDraft}
              placeholder="@maduraunited"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              style={styles.input}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>TikTok (username atau URL)</Text>
            <TextInput
              testID="tk-input"
              value={tkDraft}
              onChangeText={setTkDraft}
              placeholder="@maduraunited"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              style={styles.input}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>WhatsApp (nomor dengan kode negara)</Text>
            <TextInput
              testID="wa-input"
              value={waDraft}
              onChangeText={setWaDraft}
              placeholder="628123456789"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              style={styles.input}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>YouTube (handle atau URL)</Text>
            <TextInput
              testID="yt-input"
              value={ytDraft}
              onChangeText={setYtDraft}
              placeholder="@maduraunited"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              style={styles.input}
            />
          </View>
          <Pressable
            testID="save-info-button"
            onPress={saveInfo}
            disabled={infoSaving}
            style={[styles.cta, infoSaving && { opacity: 0.5 }]}
          >
            {infoSaving ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <>
                <Ionicons name="save" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.ctaTxt}>SIMPAN INFO</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* QUIZ ITEMS (Trivia Klub & Garuda Call) */}
        <View style={styles.formCard}>
          <View style={styles.qiHeader}>
            <Text style={styles.sectionLabel}>SOAL QUIZ · {quizItems.length}</Text>
            <View style={styles.segment}>
              <Pressable
                testID="qi-tab-trivia"
                onPress={() => {
                  setQuizCat("trivia");
                  resetQiForm();
                }}
                style={[
                  styles.segmentBtn,
                  quizCat === "trivia" && styles.segmentBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.segmentTxt,
                    quizCat === "trivia" && styles.segmentTxtActive,
                  ]}
                >
                  TRIVIA KLUB
                </Text>
              </Pressable>
              <Pressable
                testID="qi-tab-garuda"
                onPress={() => {
                  setQuizCat("garuda");
                  resetQiForm();
                }}
                style={[
                  styles.segmentBtn,
                  quizCat === "garuda" && styles.segmentBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.segmentTxt,
                    quizCat === "garuda" && styles.segmentTxtActive,
                  ]}
                >
                  GARUDA CALL
                </Text>
              </Pressable>
            </View>
          </View>

          <Pressable testID="pick-qi-image" onPress={pickQiImage} style={styles.photoPicker}>
            {qiImage ? (
              <Image source={qiImage.uri} style={styles.photoPreview} />
            ) : qiEditId &&
              quizItems.find((x) => x.item_id === qiEditId)?.image_url ? (
              <Image
                source={
                  absoluteFileUrl(
                    quizItems.find((x) => x.item_id === qiEditId)?.image_url || "",
                  ) || ""
                }
                style={styles.photoPreview}
              />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons name="image" size={32} color={colors.muted} />
                <Text style={styles.photoHint}>
                  Pilih gambar{" "}
                  {quizCat === "trivia" ? "(untuk tebak gambar)" : "(opsional)"}
                </Text>
              </View>
            )}
          </Pressable>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Pertanyaan</Text>
            <TextInput
              testID="qi-prompt-input"
              value={qiPrompt}
              onChangeText={setQiPrompt}
              placeholder={
                quizCat === "trivia"
                  ? "mis. Siapa pemain ini? / Apa stadion ini?"
                  : "mis. Kapten Timnas Indonesia saat lolos Piala Asia 2023?"
              }
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.input, { minHeight: 72, textAlignVertical: "top" }]}
            />
          </View>

          {qiOptions.map((opt, idx) => (
            <View key={idx} style={styles.field}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm as number }}>
                <Pressable
                  testID={`qi-correct-${idx}`}
                  onPress={() => setQiAnswer(idx)}
                  style={[
                    styles.correctBadge,
                    qiAnswer === idx && styles.correctBadgeActive,
                  ]}
                  hitSlop={6}
                >
                  <Text
                    style={[
                      styles.correctBadgeTxt,
                      qiAnswer === idx && styles.correctBadgeTxtActive,
                    ]}
                  >
                    {String.fromCharCode(65 + idx)}
                  </Text>
                </Pressable>
                <Text style={styles.fieldLabel}>
                  Pilihan {String.fromCharCode(65 + idx)}
                  {qiAnswer === idx ? " · JAWABAN BENAR" : ""}
                </Text>
              </View>
              <TextInput
                testID={`qi-option-${idx}`}
                value={opt}
                onChangeText={(v) =>
                  setQiOptions((prev) => prev.map((p, i) => (i === idx ? v : p)))
                }
                placeholder={`Pilihan ${String.fromCharCode(65 + idx)}`}
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
            </View>
          ))}

          <View style={{ flexDirection: "row", gap: spacing.sm as number }}>
            <Pressable
              testID="submit-qi"
              onPress={submitQi}
              disabled={qiSubmitting}
              style={[styles.cta, { flex: 1 }, qiSubmitting && { opacity: 0.5 }]}
            >
              {qiSubmitting ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <>
                  <Ionicons
                    name={qiEditId ? "save" : "add-circle"}
                    size={18}
                    color={colors.onBrandPrimary}
                  />
                  <Text style={styles.ctaTxt}>
                    {qiEditId ? "SIMPAN PERUBAHAN" : "TAMBAH SOAL"}
                  </Text>
                </>
              )}
            </Pressable>
            {qiEditId && (
              <Pressable
                testID="cancel-qi-edit"
                onPress={resetQiForm}
                style={[styles.ctaSecondary, { flex: 1 }]}
              >
                <Text style={styles.ctaSecondaryTxt}>BATAL</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.csvCard}>
            <View style={styles.csvHead}>
              <Ionicons name="cloud-upload-outline" size={18} color={colors.brandSecondary} />
              <Text style={styles.csvHeadTxt}>IMPOR MASSAL CSV</Text>
            </View>
            <Text style={styles.csvDesc}>
              Format kolom:{" "}
              <Text style={styles.csvMono}>
                prompt, option_a, option_b, option_c, option_d, answer_index, active, image_url
              </Text>
              . Baris header wajib ada. answer_index 0-3 (A-D). Kolom active & image_url
              opsional.
            </Text>
            <Pressable
              testID="import-csv-button"
              onPress={importCsv}
              disabled={csvBusy}
              style={[styles.ctaSecondaryGhost, csvBusy && { opacity: 0.5 }]}
            >
              {csvBusy ? (
                <ActivityIndicator color={colors.brandSecondary} />
              ) : (
                <>
                  <Ionicons name="document-attach" size={16} color={colors.brandSecondary} />
                  <Text style={styles.ctaSecondaryGhostTxt}>PILIH FILE CSV</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>

        <View>
          <Text style={styles.sectionLabel}>
            DAFTAR SOAL {quizCat === "trivia" ? "TRIVIA KLUB" : "GARUDA CALL"}
          </Text>
          {quizItems.length === 0 && (
            <Text style={styles.muted}>Belum ada soal. Tambahkan di atas.</Text>
          )}
          {quizItems.map((it, idx) => (
            <View key={it.item_id} style={styles.playerRow}>
              <View style={styles.reorderCol}>
                <Pressable
                  testID={`qi-up-${it.item_id}`}
                  onPress={() => moveQi(idx, -1)}
                  disabled={idx === 0}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.reorderBtn,
                    idx === 0 && { opacity: 0.3 },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Ionicons name="chevron-up" size={16} color={colors.onSurface} />
                </Pressable>
                <Pressable
                  testID={`qi-down-${it.item_id}`}
                  onPress={() => moveQi(idx, 1)}
                  disabled={idx === quizItems.length - 1}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.reorderBtn,
                    idx === quizItems.length - 1 && { opacity: 0.3 },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Ionicons name="chevron-down" size={16} color={colors.onSurface} />
                </Pressable>
              </View>
              {it.image_url ? (
                <Image
                  source={absoluteFileUrl(it.image_url) || ""}
                  style={styles.newsThumb}
                />
              ) : (
                <View style={[styles.newsThumb, styles.playerAvatarFallback]}>
                  <Ionicons name="help-circle" size={18} color={colors.muted} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text numberOfLines={2} style={styles.playerName}>
                  {idx + 1}. {it.prompt}
                </Text>
                <Text style={styles.playerMeta}>
                  Jawab: {String.fromCharCode(65 + it.answer_index)} ·{" "}
                  {it.options[it.answer_index]?.slice(0, 30)}
                </Text>
              </View>
              <Pressable
                testID={`toggle-qi-${it.item_id}`}
                onPress={() => toggleQi(it)}
                hitSlop={6}
                style={[styles.qiToggle, it.active && styles.qiToggleOn]}
              >
                <View
                  style={[
                    styles.qiToggleKnob,
                    it.active && styles.qiToggleKnobOn,
                  ]}
                />
              </Pressable>
              <Pressable
                testID={`edit-qi-${it.item_id}`}
                onPress={() => startEditQi(it)}
                hitSlop={8}
              >
                <Ionicons name="create-outline" size={20} color={colors.brandSecondary} />
              </Pressable>
              <Pressable
                testID={`delete-qi-${it.item_id}`}
                onPress={() => deleteQi(it.item_id)}
                hitSlop={8}
              >
                <Ionicons name="trash" size={20} color={colors.error} />
              </Pressable>
            </View>
          ))}
        </View>

        {/* POSTING BERITA BARU */}
        <View style={styles.formCard}>
          <Text style={styles.sectionLabel}>POSTING BERITA BARU</Text>
          <Pressable testID="pick-news-cover" onPress={pickNewsCover} style={styles.photoPicker}>
            {newsCover ? (
              <Image source={newsCover.uri} style={styles.photoPreview} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons name="image" size={32} color={colors.muted} />
                <Text style={styles.photoHint}>Pilih foto sampul (opsional)</Text>
              </View>
            )}
          </Pressable>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Judul</Text>
            <TextInput
              testID="news-title-input"
              value={newsTitle}
              onChangeText={setNewsTitle}
              placeholder="Judul berita"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Isi Artikel</Text>
            <TextInput
              testID="news-body-input"
              value={newsBody}
              onChangeText={setNewsBody}
              placeholder="Tulis update berita di sini..."
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.input, { minHeight: 160, textAlignVertical: "top" }]}
            />
          </View>
          <Pressable
            testID="submit-news-button"
            onPress={submitNews}
            disabled={newsSubmitting}
            style={[styles.cta, newsSubmitting && { opacity: 0.5 }]}
          >
            {newsSubmitting ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <>
                <Ionicons name="send" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.ctaTxt}>TERBITKAN BERITA</Text>
              </>
            )}
          </Pressable>
        </View>

        <View>
          <Text style={styles.sectionLabel}>SEMUA BERITA · {news.length}</Text>
          {news.length === 0 && <Text style={styles.muted}>Belum ada berita.</Text>}
          {news.map((n) => (
            <View key={n.news_id} style={styles.playerRow}>
              {n.cover_url ? (
                <Image source={absoluteFileUrl(n.cover_url) || ""} style={styles.newsThumb} />
              ) : (
                <View style={[styles.newsThumb, styles.playerAvatarFallback]}>
                  <Ionicons name="newspaper" size={18} color={colors.muted} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text numberOfLines={2} style={styles.playerName}>
                  {n.title}
                </Text>
                <Text style={styles.playerMeta}>
                  {new Date(n.created_at).toLocaleDateString("id-ID", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </Text>
              </View>
              <Pressable
                testID={`view-news-${n.news_id}`}
                onPress={() => router.push({ pathname: "/news/[id]", params: { id: n.news_id } })}
                hitSlop={8}
              >
                <Ionicons name="eye-outline" size={20} color={colors.brandSecondary} />
              </Pressable>
              <Pressable testID={`delete-news-${n.news_id}`} onPress={() => deleteNews(n.news_id)} hitSlop={8}>
                <Ionicons name="trash" size={20} color={colors.error} />
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>

      {resultOpen && (
        <Pressable style={styles.overlay} onPress={() => setResultOpen(null)}>
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.modal}>
            <Text style={styles.modalTitle}>HASIL AKHIR</Text>
            <View style={styles.scoreRow}>
              <TextInput
                testID="result-home"
                keyboardType="number-pad"
                value={resH}
                onChangeText={setResH}
                maxLength={2}
                placeholder="0"
                placeholderTextColor={colors.muted}
                style={styles.scoreInput}
              />
              <Text style={styles.scoreDash}>–</Text>
              <TextInput
                testID="result-away"
                keyboardType="number-pad"
                value={resA}
                onChangeText={setResA}
                maxLength={2}
                placeholder="0"
                placeholderTextColor={colors.muted}
                style={styles.scoreInput}
              />
            </View>

            <Text style={styles.sectionLabel}>⚽ PENCETAK GOL (pilih bisa lebih dari satu)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm as number }}>
              {players.map((p) => {
                const active = resScorerIds.includes(p.player_id);
                return (
                  <Pressable
                    key={p.player_id}
                    testID={`result-scorer-${p.player_id}`}
                    onPress={() => toggleScorer(p.player_id)}
                    style={[chipStyles.chip, active && chipStyles.chipActive]}
                  >
                    <Text style={chipStyles.chipTxt}>{p.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={styles.sectionLabel}>🏆 MAN OF THE MATCH</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm as number }}>
              <Pressable
                testID="result-motm-none"
                onPress={() => setResMotmId(null)}
                style={[chipStyles.chip, !resMotmId && chipStyles.chipActive]}
              >
                <Text style={chipStyles.chipTxt}>Tidak pilih</Text>
              </Pressable>
              {players.map((p) => (
                <Pressable
                  key={p.player_id}
                  testID={`result-motm-${p.player_id}`}
                  onPress={() => setResMotmId(p.player_id)}
                  style={[chipStyles.chip, resMotmId === p.player_id && chipStyles.chipActive]}
                >
                  <Text style={chipStyles.chipTxt}>{p.name}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Pressable testID="submit-result" onPress={submitResult} style={styles.modalCta}>
              <Text style={styles.modalCtaTxt}>SIMPAN & NILAI PREDIKSI</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      )}
    </View>
  );
}

function GateView({
  router,
  insets,
  icon,
  title,
  body,
  action,
  actionLabel,
}: {
  router: ReturnType<typeof useRouter>;
  insets: ReturnType<typeof useSafeAreaInsets>;
  icon: any;
  title: string;
  body: string;
  action: () => void;
  actionLabel: string;
}) {
  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitleCenter}>ADMIN</Text>
        <View style={{ width: 32 }} />
      </View>
      <View style={styles.gateBody}>
        <Ionicons name={icon} size={64} color={colors.muted} />
        <Text style={styles.gateTitle}>{title}</Text>
        <Text style={styles.gateMsg}>{body}</Text>
        <Pressable testID="gate-action" onPress={action} style={styles.cta}>
          <Text style={styles.ctaTxt}>{actionLabel}</Text>
        </Pressable>
      </View>
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
  backBtn: { padding: spacing.xs },
  headerTag: { color: colors.muted, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  headerTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  headerTitleCenter: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: "900", letterSpacing: 2, textAlign: "center" },
  adminBadge: {
    flexDirection: "row",
    gap: 4,
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    alignItems: "center",
  },
  adminBadgeTxt: { color: colors.onBrandSecondary, fontWeight: "900", fontSize: 10, letterSpacing: 1.5 },
  gateBody: { flex: 1, padding: spacing.xl, alignItems: "center", justifyContent: "center", gap: spacing.md as number },
  gateTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "900", marginTop: spacing.md },
  gateMsg: { color: colors.muted, fontSize: 13, textAlign: "center" },
  formCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md as number,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  seedBtn: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  seedTxt: { color: colors.onBrandSecondary, fontWeight: "900", fontSize: 10, letterSpacing: 1 },
  photoPicker: {
    width: "100%",
    aspectRatio: 4 / 5,
    maxHeight: 240,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    alignSelf: "center",
  },
  photoPreview: { width: "100%", height: "100%" },
  photoPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm as number },
  photoHint: { color: colors.muted, fontSize: 12 },
  field: { gap: spacing.xs as number },
  fieldLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.md,
    color: colors.onSurface,
    fontSize: 14,
  },
  posRow: { flexDirection: "row", gap: spacing.sm as number },
  posChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  posChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  posTxt: { color: colors.muted, fontWeight: "900", fontSize: 13, letterSpacing: 1 },
  posTxtActive: { color: colors.onBrandPrimary },
  msg: { fontSize: 12 },
  msgOk: { color: colors.success },
  msgErr: { color: colors.error },
  cta: {
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm as number,
  },
  ctaTxt: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 14, letterSpacing: 2 },
  ctaSecondary: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.lg,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm as number,
  },
  ctaSecondaryTxt: { color: colors.error, fontWeight: "900", fontSize: 13, letterSpacing: 1.5 },
  helpText: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  newsThumb: {
    width: 56,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
  },
  qiHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    gap: spacing.sm as number,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    padding: 3,
  },
  segmentBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  segmentBtnActive: {
    backgroundColor: colors.brandPrimary,
  },
  segmentTxt: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  segmentTxtActive: { color: colors.onBrandPrimary },
  correctBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  correctBadgeActive: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  correctBadgeTxt: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  correctBadgeTxtActive: { color: colors.onBrand },
  qiToggle: {
    width: 40,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceTertiary,
    padding: 2,
    justifyContent: "center",
  },
  qiToggleOn: { backgroundColor: colors.success },
  qiToggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.onBrandPrimary,
  },
  qiToggleKnobOn: { alignSelf: "flex-end" },
  reorderCol: {
    gap: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  reorderBtn: {
    width: 24,
    height: 20,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  csvCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm as number,
  },
  csvHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm as number,
  },
  csvHeadTxt: {
    color: colors.onSurface,
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 1.5,
  },
  csvDesc: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  csvMono: {
    color: colors.onSurface,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  ctaSecondaryGhost: {
    borderWidth: 1.5,
    borderColor: colors.brandSecondary,
    borderRadius: radius.md,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm as number,
  },
  ctaSecondaryGhostTxt: {
    color: colors.brandSecondary,
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 1.5,
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md as number,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  playerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceSecondary },
  playerAvatarFallback: { alignItems: "center", justifyContent: "center" },
  playerName: { color: colors.onSurface, fontSize: 14, fontWeight: "800" },
  playerMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  toggle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleOn: { backgroundColor: colors.success },
  toggleOff: { backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  muted: { color: colors.muted, fontSize: 13 },
  overlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modal: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md as number,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  modalTitle: { color: colors.onSurface, fontWeight: "900", fontSize: 16, letterSpacing: 2, textAlign: "center" },
  scoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md as number },
  scoreInput: {
    width: 80, height: 80,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    color: colors.onSurface,
    fontSize: 36, fontWeight: "900", textAlign: "center",
    borderWidth: 1.5, borderColor: colors.border,
  },
  scoreDash: { color: colors.muted, fontSize: 32, fontWeight: "900" },
  modalCta: {
    backgroundColor: colors.brandPrimary,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
  },
  modalCtaTxt: { color: colors.onBrandPrimary, fontWeight: "900", fontSize: 13, letterSpacing: 2 },
});

const chipStyles = StyleSheet.create({
  chip: {
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { borderColor: colors.brandSecondary, backgroundColor: colors.brandTertiary },
  chipTxt: { color: colors.onSurface, fontSize: 12, fontWeight: "700" },
});
