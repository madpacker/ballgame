import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { api, getToken, setToken, type User } from "@/src/api";

WebBrowser.maybeCompleteAuthSession();

type AuthState = {
  loading: boolean;
  user: User | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState>({
  loading: true,
  user: null,
  signIn: async () => {},
  signOut: async () => {},
});

const EXCHANGED = new Set<string>();

function extractSessionIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const androidLinkRef = useRef<string | null>(null);

  const exchange = async (sessionId: string) => {
    if (EXCHANGED.has(sessionId)) return;
    EXCHANGED.add(sessionId);
    try {
      const res = await api<{ session_token: string; user: User }>(
        "/auth/session",
        { method: "POST", body: JSON.stringify({ session_id: sessionId }) },
      );
      await setToken(res.session_token);
      setUser(res.user);
    } catch (e) {
      console.warn("auth exchange failed", e);
    }
  };

  const refreshFromToken = async () => {
    const t = await getToken();
    if (!t) {
      setUser(null);
      return;
    }
    try {
      const me = await api<User>("/auth/me");
      setUser(me);
    } catch {
      await setToken(null);
      setUser(null);
    }
  };

  useEffect(() => {
    let unsub: { remove: () => void } | null = null;

    const bootstrap = async () => {
      // Web: parse hash/query for session_id first.
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const url = window.location.href;
        const sid = extractSessionIdFromUrl(url);
        if (sid) {
          await exchange(sid);
          try {
            const u = new URL(window.location.href);
            u.hash = "";
            u.searchParams.delete("session_id");
            window.history.replaceState(window.history.state, "", u.toString());
          } catch {}
        }
      } else {
        // Mobile cold start
        const initial = await Linking.getInitialURL();
        const sid = extractSessionIdFromUrl(initial);
        if (sid) await exchange(sid);
        unsub = Linking.addEventListener("url", (e) => {
          const s = extractSessionIdFromUrl(e.url);
          if (s) {
            androidLinkRef.current = e.url;
            exchange(s);
          }
        });
      }

      await refreshFromToken();
      setLoading(false);
    };

    bootstrap();
    return () => {
      if (unsub) unsub.remove();
    };
  }, []);

  const signIn = async () => {
    const redirectUrl =
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.origin + "/"
        : Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.location.href = authUrl;
      return;
    }

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    let callbackUrl: string | null = null;
    if (result.type === "success" && (result as any).url) {
      callbackUrl = (result as any).url as string;
    }
    let sid = extractSessionIdFromUrl(callbackUrl);
    if (!sid) sid = extractSessionIdFromUrl(androidLinkRef.current);
    if (!sid) {
      const init = await Linking.getInitialURL();
      sid = extractSessionIdFromUrl(init);
    }
    if (sid) await exchange(sid);
  };

  const signOut = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    await setToken(null);
    setUser(null);
  };

  return <Ctx.Provider value={{ loading, user, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
