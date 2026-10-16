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
import { useEffect, useState } from "react";
import * as Haptics from "expo-haptics";

import { colors, radius, spacing } from "@/src/theme";
import { useAuth } from "@/src/contexts/auth";
import { api, getToken } from "@/src/api";
import { uploadForm } from "@/src/utils/upload";
import { absolutePhotoUrl, type ApiPlayer } from "@/src/data/questions";

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
  };

  useEffect(() => {
    if (user?.is_admin) refresh();
    else setLoading(false);
  }, [user]);

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
