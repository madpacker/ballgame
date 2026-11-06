import { useEffect, useState, useCallback } from "react";
import { api } from "@/src/api";

export type Socials = {
  instagram?: string | null;
  tiktok?: string | null;
  whatsapp?: string | null;
  youtube?: string | null;
};

export type AppSettings = {
  background_url?: string | null;
  description?: string | null;
  socials: Socials;
  tournament_enabled?: boolean;
  category_logos?: Record<string, string>;
  mascot_url?: string | null;
};

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

export function absoluteFileUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${BACKEND}${url}`;
}

const EMPTY: AppSettings = { socials: {} };

let cache: AppSettings | null = null;
const listeners = new Set<(s: AppSettings) => void>();

async function fetchSettings(): Promise<AppSettings> {
  try {
    const s = await api<AppSettings>("/app-settings");
    cache = s;
    listeners.forEach((cb) => cb(s));
    return s;
  } catch {
    return cache ?? EMPTY;
  }
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(cache ?? EMPTY);
  const [loading, setLoading] = useState<boolean>(!cache);

  const refresh = useCallback(async () => {
    setLoading(true);
    const s = await fetchSettings();
    setSettings(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    const cb = (s: AppSettings) => setSettings(s);
    listeners.add(cb);
    if (!cache) {
      refresh();
    } else {
      // keep in sync in background
      fetchSettings();
    }
    return () => {
      listeners.delete(cb);
    };
  }, [refresh]);

  return { settings, loading, refresh };
}
