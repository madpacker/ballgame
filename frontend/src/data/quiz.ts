// All question content is now admin-managed via the backend:
// - "guess" & "history" come from /api/players (admin dashboard: Pemain)
// - "trivia" & "garuda" come from /api/quiz-items (admin dashboard: Soal Trivia & Garuda Call)
// The static QUESTIONS array has been intentionally emptied — see questions.ts for the
// fetch pipeline. BACKGROUNDS are still bundled so the stadium/jersey/trophy visuals keep
// working even before the admin uploads a custom background.
export type Category = "guess" | "history" | "trivia" | "garuda";

export type Question = {
  id: string;
  category: Category;
  prompt: string;
  image?: string; // used for "guess", "trivia", optionally "garuda"
  options: string[];
  answerIndex: number;
  explanation?: string;
};

export const CATEGORY_LABEL: Record<Category | "all", string> = {
  all: "Semua Kategori",
  guess: "Tebak Pemain",
  history: "Sejarah Pemain",
  trivia: "Trivia Klub",
  garuda: "Garuda Call",
};

export const CATEGORY_DESC: Record<Category | "all", string> = {
  all: "Campuran semua jenis pertanyaan",
  guess: "Tebak nama pemain dari foto",
  history: "Dari klub mana pemain ini berasal?",
  trivia: "Tebak gambar seputar klub Laskar Sape Kerap",
  garuda: "Trivia Tim Nasional Garuda",
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
