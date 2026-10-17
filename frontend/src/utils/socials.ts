// Builds openable URLs from either raw handles ("@maduraunited") or full URLs.
export type SocialPlatform = "instagram" | "tiktok" | "whatsapp" | "youtube";

function stripAt(h: string): string {
  return h.replace(/^@/, "").trim();
}

export function socialUrlFor(platform: SocialPlatform, value?: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  switch (platform) {
    case "instagram":
      return `https://instagram.com/${stripAt(v)}`;
    case "tiktok":
      return `https://www.tiktok.com/@${stripAt(v)}`;
    case "youtube":
      return `https://youtube.com/${stripAt(v).startsWith("@") ? stripAt(v) : "@" + stripAt(v)}`;
    case "whatsapp": {
      const digits = v.replace(/[^0-9]/g, "");
      if (!digits) return null;
      return `https://wa.me/${digits}`;
    }
  }
}

export function socialLabelFor(platform: SocialPlatform, value?: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v.replace(/^https?:\/\//, "");
  if (platform === "whatsapp") return "+" + v.replace(/[^0-9]/g, "");
  return "@" + stripAt(v);
}
