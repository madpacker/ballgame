import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/src/contexts/auth";
import { api } from "@/src/api";

export type SkinKey = "home" | "away" | "third" | "champion";

export const SKINS: Record<SkinKey, { label: string; primary: string; onPrimary: string; secondary: string; description: string; emoji?: string }> = {
  home: {
    label: "HOME · Merah",
    primary: "#C8102E",
    onPrimary: "#FFFFFF",
    secondary: "#D4AF37",
    description: "Jersey kandang klasik, merah menyala.",
  },
  away: {
    label: "AWAY · Putih",
    primary: "#F8F9FA",
    onPrimary: "#0F1115",
    secondary: "#C8102E",
    description: "Away kit bersih dengan aksen merah.",
  },
  third: {
    label: "THIRD · Emas",
    primary: "#D4AF37",
    onPrimary: "#1A1A1A",
    secondary: "#C8102E",
    description: "Edisi spesial berwarna emas kerajaan.",
  },
  champion: {
    label: "CHAMPION",
    primary: "#8B5CF6",
    onPrimary: "#FFFFFF",
    secondary: "#D4AF37",
    description: "Skin eksklusif untuk Juara 1 mingguan — aktif 7 hari.",
    emoji: "👑",
  },
};

const KEY = "cakmad.skin";

type SkinCtx = {
  skin: SkinKey;
  setSkin: (s: SkinKey) => void;
  accent: typeof SKINS["home"];
  championUnlocked: boolean;
  championUntil?: string | null;
};

const Ctx = createContext<SkinCtx>({
  skin: "home",
  setSkin: () => {},
  accent: SKINS.home,
  championUnlocked: false,
});

export function SkinProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [skin, setSkinState] = useState<SkinKey>("home");
  const [championUntil, setChampionUntil] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v && (v === "home" || v === "away" || v === "third" || v === "champion")) setSkinState(v);
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setChampionUntil(null);
      return;
    }
    api<{ champion: { locked: boolean; until?: string | null } }>("/me/skins")
      .then((r) => setChampionUntil(r.champion.locked ? null : (r.champion.until ?? null)))
      .catch(() => setChampionUntil(null));
  }, [user]);

  const championUnlocked = !!championUntil;

  // If current skin is champion but no longer unlocked, fall back to home.
  useEffect(() => {
    if (skin === "champion" && !championUnlocked) {
      setSkinState("home");
      AsyncStorage.setItem(KEY, "home").catch(() => {});
    }
  }, [championUnlocked, skin]);

  const setSkin = (s: SkinKey) => {
    if (s === "champion" && !championUnlocked) return;
    setSkinState(s);
    AsyncStorage.setItem(KEY, s).catch(() => {});
  };

  return (
    <Ctx.Provider value={{ skin, setSkin, accent: SKINS[skin], championUnlocked, championUntil }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSkin() {
  return useContext(Ctx);
}
