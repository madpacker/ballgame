import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type SkinKey = "home" | "away" | "third";

export const SKINS: Record<SkinKey, { label: string; primary: string; onPrimary: string; secondary: string; description: string }> = {
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
};

const KEY = "cakmad.skin";

type SkinCtx = {
  skin: SkinKey;
  setSkin: (s: SkinKey) => void;
  accent: typeof SKINS["home"];
};

const Ctx = createContext<SkinCtx>({ skin: "home", setSkin: () => {}, accent: SKINS.home });

export function SkinProvider({ children }: { children: ReactNode }) {
  const [skin, setSkinState] = useState<SkinKey>("home");

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v && (v === "home" || v === "away" || v === "third")) setSkinState(v);
    });
  }, []);

  const setSkin = (s: SkinKey) => {
    setSkinState(s);
    AsyncStorage.setItem(KEY, s).catch(() => {});
  };

  return <Ctx.Provider value={{ skin, setSkin, accent: SKINS[skin] }}>{children}</Ctx.Provider>;
}

export function useSkin() {
  return useContext(Ctx);
}
