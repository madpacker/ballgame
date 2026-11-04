import { api } from "@/src/api";
import { type Category, type Question } from "@/src/data/quiz";

export type ApiPlayer = {
  player_id: string;
  name: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  years_at_mu?: string | null;
  previous_clubs: string[];
  photo_url?: string | null;
  included_in_quiz: boolean;
};

export type ApiQuizItem = {
  item_id: string;
  category: Category;
  prompt: string;
  image_url?: string | null;
  options: string[];
  answer_index: number;
  active: boolean;
  order_index: number;
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
    return players.filter(
      (p) => !!p.years_at_mu && years.some((y: string) => (p.years_at_mu ?? "").includes(y)),
    );
  }
  if (filter_type === "previous_club_contains") {
    const needles = (Array.isArray(filter_value) ? filter_value : [filter_value]).map(
      (s: string) => s.toLowerCase(),
    );
    return players.filter((p) =>
      p.previous_clubs.some((c) => needles.some((n: string) => c.toLowerCase().includes(n))),
    );
  }
  if (filter_type === "foreign") {
    return players.filter(
      (p) => !p.previous_clubs.some((c) => INDONESIAN_CLUBS.some((ic) => c.includes(ic))),
    );
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
  const fallback = ["Persija Jakarta", "Arema FC", "Persib Bandung", "PSS Sleman", "Bali United"];
  while (distractors.length < count - 1) {
    const f = fallback[Math.floor(Math.random() * fallback.length)];
    if (f !== correct && !distractors.includes(f)) distractors.push(f);
  }
  const all = shuffle([correct, ...distractors]);
  return all;
}

export function playersToQuestions(players: ApiPlayer[]): Question[] {
  // Picture questions from player photos (used only by weekly themed challenges).
  const inPool = players.filter((p) => p.included_in_quiz !== false);
  const withPhoto = inPool.filter((p) => p.photo_url);
  const names = inPool.map((p) => p.name);
  return withPhoto.map((p) => {
    const opts = pickOptions(p.name, names);
    return {
      id: `dyn-g-${p.player_id}`,
      category: "trivia" as Category,
      prompt: "Siapa pemain Madura United ini?",
      image: absolutePhotoUrl(p.photo_url),
      options: opts,
      answerIndex: opts.indexOf(p.name),
    };
  });
}

export function quizItemsToQuestions(items: ApiQuizItem[]): Question[] {
  return items.map((it) => ({
    id: `qi-${it.item_id}`,
    category: it.category as Category,
    prompt: it.prompt,
    image: absolutePhotoUrl(it.image_url),
    options: it.options,
    answerIndex: Math.max(0, Math.min(3, it.answer_index)),
  }));
}

export async function fetchDynamicPlayers(): Promise<ApiPlayer[]> {
  try {
    return await api<ApiPlayer[]>("/players");
  } catch {
    return [];
  }
}

export async function fetchQuizItems(category: Category | "all"): Promise<ApiQuizItem[]> {
  try {
    return await api<ApiQuizItem[]>(`/quiz-items?category=${category}`);
  } catch {
    return [];
  }
}

export async function pickDynamicQuestions(
  cat: Category | "all" | "tournament",
  count: number,
  theme?: ThemeFilter | null,
): Promise<Question[]> {
  let pool: Question[];
  if (theme) {
    // Weekly themed challenges still filter Madura United player photos.
    const players = await fetchDynamicPlayers();
    pool = playersToQuestions(filterPlayersByTheme(players, theme));
  } else {
    // "all" and "tournament" mix every admin category; otherwise just the chosen one.
    const key = cat === "all" || cat === "tournament" ? "all" : cat;
    pool = quizItemsToQuestions(await fetchQuizItems(key));
  }
  return shuffle(pool).slice(0, Math.min(count, pool.length));
}
