import { api } from "@/src/api";
import { pickQuestions as pickStatic, type Category, type Question } from "@/src/data/quiz";

export type ApiPlayer = {
  player_id: string;
  name: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  years_at_mu?: string | null;
  previous_clubs: string[];
  photo_url?: string | null;
  included_in_quiz: boolean;
};

export type ThemeFilter = {
  id: string;
  filter_type: string;
  filter_value: any;
};

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

const INDONESIAN_CLUBS = [
  "Persija",
  "Arema",
  "Persipura",
  "Sriwijaya",
  "Mitra Kukar",
  "Barito",
  "Persija Jakarta",
  "Persebaya Surabaya",
  "Semen Padang",
  "Bhayangkara",
  "Persegres",
  "Deltras",
  "Persisam",
  "Persijap",
];

function filterPlayersByTheme(players: ApiPlayer[], theme: ThemeFilter | null): ApiPlayer[] {
  if (!theme) return players;
  const { filter_type, filter_value } = theme;
  if (filter_type === "position") {
    return players.filter((p) => Array.isArray(filter_value) && filter_value.includes(p.position));
  }
  if (filter_type === "years_contains") {
    const years = Array.isArray(filter_value) ? filter_value : [filter_value];
    return players.filter((p) =>
      !!p.years_at_mu && years.some((y: string) => (p.years_at_mu ?? "").includes(y)),
    );
  }
  if (filter_type === "previous_club_contains") {
    const needles = (Array.isArray(filter_value) ? filter_value : [filter_value]).map((s: string) => s.toLowerCase());
    return players.filter((p) =>
      p.previous_clubs.some((c) => needles.some((n: string) => c.toLowerCase().includes(n))),
    );
  }
  if (filter_type === "foreign") {
    return players.filter((p) => !p.previous_clubs.some((c) => INDONESIAN_CLUBS.some((ic) => c.includes(ic))));
  }
  return players;
}

export function absolutePhotoUrl(url?: string | null) {
  if (!url) return undefined;
  if (/^https?:\/\//.test(url)) return url;
  return `${BACKEND}${url}`;
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

function pickOptions(correct: string, pool: string[], count = 4): string[] {
  const unique = Array.from(new Set(pool.filter((p) => p && p !== correct)));
  const distractors = shuffle(unique).slice(0, count - 1);
  // Pad with generic fallbacks if too few options
  const fallback = ["Persija Jakarta", "Arema FC", "Persib Bandung", "PSS Sleman", "Bali United"];
  while (distractors.length < count - 1) {
    const f = fallback[Math.floor(Math.random() * fallback.length)];
    if (f !== correct && !distractors.includes(f)) distractors.push(f);
  }
  const all = shuffle([correct, ...distractors]);
  return all;
}

export function playersToQuestions(players: ApiPlayer[]): Question[] {
  const withPhoto = players.filter((p) => p.photo_url);
  const names = players.map((p) => p.name);
  const clubs = players.flatMap((p) => p.previous_clubs);

  const guess: Question[] = withPhoto.map((p) => {
    const opts = pickOptions(p.name, names);
    return {
      id: `dyn-g-${p.player_id}`,
      category: "guess" as Category,
      prompt: "Siapa pemain Madura United ini?",
      image: absolutePhotoUrl(p.photo_url),
      options: opts,
      answerIndex: opts.indexOf(p.name),
    };
  });

  const history: Question[] = players
    .filter((p) => p.previous_clubs.length > 0)
    .map((p) => {
      const correct = p.previous_clubs[0];
      const opts = pickOptions(correct, clubs);
      return {
        id: `dyn-h-${p.player_id}`,
        category: "history" as Category,
        prompt: `Sebelum ke Madura United, ${p.name} pernah membela klub...`,
        options: opts,
        answerIndex: opts.indexOf(correct),
      };
    });

  return [...guess, ...history];
}

export async function fetchDynamicPlayers(): Promise<ApiPlayer[]> {
  try {
    return await api<ApiPlayer[]>("/players");
  } catch {
    return [];
  }
}

export async function pickDynamicQuestions(
  cat: Category | "all",
  count: number,
  theme?: ThemeFilter | null,
): Promise<Question[]> {
  const players = await fetchDynamicPlayers();
  const filtered = filterPlayersByTheme(players, theme ?? null);
  const dyn = playersToQuestions(filtered);
  const staticAll = pickStatic("all", 999);
  // When a theme is active, restrict to dynamic (themed) pool and skip static.
  const pool = theme
    ? cat === "all"
      ? dyn
      : dyn.filter((q) => q.category === cat)
    : cat === "all"
      ? [...dyn, ...staticAll]
      : [...dyn.filter((q) => q.category === cat), ...staticAll.filter((q) => q.category === cat)];
  const final = pool.length > 0 ? pool : staticAll; // fallback if theme filter empties pool
  return shuffle(final).slice(0, Math.min(count, final.length));
}
