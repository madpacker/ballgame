// All question content is admin-managed via /api/quiz-items (per category, CSV import supported).
// "trivia" key = Madura United (renamed; key kept so existing data/links keep working).
export type Category = "trivia" | "garuda" | "liga" | "bali" | "persebaya" | "persib" | "persija";

export type Question = {
  id: string;
  category: Category;
  prompt: string;
  image?: string;
  options: string[];
  answerIndex: number;
  explanation?: string;
};

// Order used in the category grid and admin tabs.
export const QUIZ_CATEGORY_KEYS: Category[] = ["liga", "bali", "trivia", "garuda", "persebaya", "persib", "persija"];

export const CATEGORY_LABEL: Record<Category | "all", string> = {
  all: "Semua Kategori",
  liga: "Liga Indonesia",
  bali: "Bali United",
  trivia: "Madura United",
  garuda: "Garuda Call",
  persebaya: "Persebaya",
  persib: "Persib Bandung",
  persija: "Persija",
};

export const CATEGORY_DESC: Record<Category | "all", string> = {
  all: "Campuran semua jenis pertanyaan",
  liga: "Tebak klub & sejarah Liga Indonesia",
  bali: "Kuis seputar Serdadu Tridatu",
  trivia: "Tebak gambar seputar klub Laskar Sape Kerap",
  garuda: "Tebak pemain Timnas Indonesia (Garuda)",
  persebaya: "Kuis seputar klub Bajul Ijo",
  persib: "Kuis seputar Pangeran Biru",
  persija: "Tantangan kuis tim Macan Kemayoran",
};

// Club accent colours — brand colours, identical in every theme.
export const CATEGORY_COLOR: Record<Category | "all", string> = {
  all: "#E31B23",
  liga: "#C9A44C",
  bali: "#D7262E",
  trivia: "#E0262B",
  garuda: "#E0A526",
  persebaya: "#22A24A",
  persib: "#2D6BEA",
  persija: "#F0302A",
};

// Stable background images used by the hero + quiz backdrops.
const IMG = {
  stadium:
    "https://images.unsplash.com/photo-1679391029864-d46f366a456b?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA4Mzl8MHwxfHNlYXJjaHwyfHxmb290YmFsbCUyMHN0YWRpdW0lMjBkYXJrJTIwYXRtb3NwaGVyaWMlMjBiYWNrZ3JvdW5kfGVufDB8fHx8MTc5MjA4OTEzNnww&ixlib=rb-4.1.0&q=85",
  jersey:
    "https://images.unsplash.com/photo-1577212017184-80cc0da11082?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1OTV8MHwxfHNlYXJjaHwxfHxyZWQlMjBzb2NjZXIlMjBqZXJzZXl8ZW58MHx8fHwxNzkyMDg5MTQxfDA&ixlib=rb-4.1.0&q=85",
  trophy:
    "https://images.unsplash.com/photo-1578269174936-2709b6aeb913?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NzR8MHwxfHNlYXJjaHwxfHxnb2xkJTIwdHJvcGh5JTIwY3VwJTIwaXNvbGF0ZWR8ZW58MHx8fHwxNzkyMDg5MTQxfDA&ixlib=rb-4.1.0&q=85",
};

// Static question pool intentionally empty — every question now comes from the admin.
export const QUESTIONS: Question[] = [];

export function pickQuestions(_cat: Category | "all", _count: number): Question[] {
  return [];
}

export const BACKGROUNDS = {
  stadium: IMG.stadium,
  jersey: IMG.jersey,
  trophy: IMG.trophy,
};
