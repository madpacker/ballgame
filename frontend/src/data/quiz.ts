// Sample Madura United quiz questions. Images are stable placeholders; user will
// upload real player photos later.
export type Category = "guess" | "history" | "trivia";

export type Question = {
  id: string;
  category: Category;
  prompt: string;
  image?: string; // used for "guess" category
  options: string[];
  answerIndex: number;
  explanation?: string;
};

export const CATEGORY_LABEL: Record<Category | "all", string> = {
  all: "Semua Kategori",
  guess: "Tebak Pemain",
  history: "Sejarah Pemain",
  trivia: "Trivia Klub",
};

export const CATEGORY_DESC: Record<Category | "all", string> = {
  all: "Campuran semua jenis pertanyaan",
  guess: "Tebak nama pemain dari foto",
  history: "Dari klub mana pemain ini berasal?",
  trivia: "Sejarah & fakta klub Laskar Sape Kerap",
};

// Public, stable Wikipedia / placeholder images.
const IMG = {
  stadium:
    "https://images.unsplash.com/photo-1679391029864-d46f366a456b?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA4Mzl8MHwxfHNlYXJjaHwyfHxmb290YmFsbCUyMHN0YWRpdW0lMjBkYXJrJTIwYXRtb3NwaGVyaWMlMjBiYWNrZ3JvdW5kfGVufDB8fHx8MTc5MjA4OTEzNnww&ixlib=rb-4.1.0&q=85",
  jersey:
    "https://images.unsplash.com/photo-1577212017184-80cc0da11082?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1OTV8MHwxfHNlYXJjaHwxfHxyZWQlMjBzb2NjZXIlMjBqZXJzZXl8ZW58MHx8fHwxNzkyMDg5MTQxfDA&ixlib=rb-4.1.0&q=85",
  player1:
    "https://images.unsplash.com/photo-1516224498413-84ecf3a1e7fd?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzF8MHwxfHNlYXJjaHwxfHxzb2NjZXIlMjBwbGF5ZXIlMjBmYWNlJTIwcG9ydHJhaXR8ZW58MHx8fHwxNzkyMDg5MTQxfDA&ixlib=rb-4.1.0&q=85",
  player2:
    "https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=800&q=85",
  player3:
    "https://images.unsplash.com/photo-1510925758641-869d353cecc7?w=800&q=85",
  trophy:
    "https://images.unsplash.com/photo-1578269174936-2709b6aeb913?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NzR8MHwxfHNlYXJjaHwxfHxnb2xkJTIwdHJvcGh5JTIwY3VwJTIwaXNvbGF0ZWR8ZW58MHx8fHwxNzkyMDg5MTQxfDA&ixlib=rb-4.1.0&q=85",
};

export const QUESTIONS: Question[] = [
  // ---- Guess Player ----
  {
    id: "g1",
    category: "guess",
    prompt: "Siapa striker legendaris Madura United ini?",
    image: IMG.player1,
    options: ["Peter Odemwingie", "Greg Nwokolo", "Beto Goncalves", "Bruno Matos"],
    answerIndex: 2,
    explanation: "Beto Goncalves adalah salah satu striker ikonik Madura United.",
  },
  {
    id: "g2",
    category: "guess",
    prompt: "Tebak gelandang serang Madura United berikut:",
    image: IMG.player2,
    options: ["Andik Vermansah", "Slamet Nurcahyo", "Zulfiandi", "Bayu Gatra"],
    answerIndex: 3,
    explanation: "Bayu Gatra lama membela Laskar Sape Kerap sebagai gelandang serang.",
  },
  {
    id: "g3",
    category: "guess",
    prompt: "Pemain bertahan asal Madura ini bernama...",
    image: IMG.player3,
    options: ["Fachrudin Aryanto", "Jaimerson Xavier", "Alfath Fathier", "Hansamu Yama"],
    answerIndex: 0,
    explanation: "Fachrudin Aryanto adalah bek tangguh asal Indonesia.",
  },
  {
    id: "g4",
    category: "guess",
    prompt: "Siapa penjaga gawang di gambar ini?",
    image: IMG.player1,
    options: ["Hery Prasetyo", "Satria Tama", "Herry Setyawan", "Dhika Bayangkara"],
    answerIndex: 1,
    explanation: "Satria Tama pernah menjadi kiper utama Madura United.",
  },
  {
    id: "g5",
    category: "guess",
    prompt: "Pemain muda Madura United berikut adalah:",
    image: IMG.player2,
    options: ["Hugo Gomes", "Jacob Pepper", "Lulinha", "Alberto Goncalves"],
    answerIndex: 2,
    explanation: "Lulinha asal Brazil pernah bermain untuk Madura United.",
  },

  // ---- Player History ----
  {
    id: "h1",
    category: "history",
    prompt: "Sebelum ke Madura United, Beto Goncalves bermain di klub mana?",
    options: ["Sriwijaya FC", "Persipura Jayapura", "Arema FC", "Mitra Kukar"],
    answerIndex: 0,
    explanation: "Beto sempat mencetak banyak gol bersama Sriwijaya FC.",
  },
  {
    id: "h2",
    category: "history",
    prompt: "Bayu Gatra memulai karier profesional di klub...",
    options: ["Persisam Samarinda", "Mitra Kukar", "Barito Putera", "Persija Jakarta"],
    answerIndex: 1,
    explanation: "Bayu Gatra memulai karier bersama Mitra Kukar.",
  },
  {
    id: "h3",
    category: "history",
    prompt: "Alberto Goncalves pernah menjadi top skor Liga Indonesia bersama klub...",
    options: ["Arema", "Sriwijaya FC", "Persipura", "PSM Makassar"],
    answerIndex: 1,
    explanation: "Alberto pernah menjadi top skor di Sriwijaya FC.",
  },
  {
    id: "h4",
    category: "history",
    prompt: "Peter Odemwingie, mantan penyerang Madura, lama bermain di liga...",
    options: ["Jerman", "Prancis", "Inggris (Premier League)", "Belanda"],
    answerIndex: 2,
    explanation: "Odemwingie dikenal di Premier League (West Brom, Cardiff, Stoke).",
  },
  {
    id: "h5",
    category: "history",
    prompt: "Slamet Nurcahyo sebelum di Madura United bermain untuk...",
    options: ["Persija Jakarta", "Arema FC", "Persela Lamongan", "Persipura"],
    answerIndex: 1,
    explanation: "Slamet Nurcahyo lama membela Arema FC.",
  },
  {
    id: "h6",
    category: "history",
    prompt: "Jaimerson Xavier, bek Madura United, berasal dari negara...",
    options: ["Argentina", "Brasil", "Portugal", "Spanyol"],
    answerIndex: 1,
    explanation: "Jaimerson adalah bek asal Brasil.",
  },

  // ---- Club Trivia ----
  {
    id: "t1",
    category: "trivia",
    prompt: "Julukan resmi klub Madura United adalah...",
    options: ["Laskar Sape Kerap", "Macan Madura", "Singo Edan", "Elang Nusantara"],
    answerIndex: 0,
    explanation: "Julukan 'Laskar Sape Kerap' diambil dari tradisi karapan sapi Madura.",
  },
  {
    id: "t2",
    category: "trivia",
    prompt: "Madura United berdiri sebagai perubahan nama dari klub...",
    options: ["Persema Malang", "Pelita Jaya", "Persipasi Bekasi", "Persisam Samarinda"],
    answerIndex: 1,
    explanation: "Madura United merupakan transformasi dari Pelita Jaya (via Pelita Bandung Raya).",
  },
  {
    id: "t3",
    category: "trivia",
    prompt: "Warna khas jersey kandang Madura United adalah...",
    options: ["Biru - Putih", "Merah - Putih", "Hijau - Kuning", "Hitam - Oranye"],
    answerIndex: 1,
    explanation: "Warna merah-putih menjadi identitas Madura United.",
  },
  {
    id: "t4",
    category: "trivia",
    prompt: "Markas kandang Madura United berada di stadion...",
    options: ["Stadion Gelora Bangkalan", "Stadion Gelora Ratu Pamelingan", "Stadion Ahmad Yani", "Stadion Gajayana"],
    answerIndex: 1,
    explanation: "Stadion Gelora Ratu Pamelingan (SGRP) di Pamekasan adalah kandang utama.",
  },
  {
    id: "t5",
    category: "trivia",
    prompt: "Pemilik mayoritas Madura United adalah...",
    options: ["Erick Thohir", "Achsanul Qosasi", "Kaesang Pangarep", "Prabowo Subianto"],
    answerIndex: 1,
    explanation: "Achsanul Qosasi dikenal sebagai pemilik Madura United.",
  },
  {
    id: "t6",
    category: "trivia",
    prompt: "Rival utama Madura United dalam Derby Jawa Timur adalah...",
    options: ["PSS Sleman", "PSIS Semarang", "Persebaya & Arema", "Bali United"],
    answerIndex: 2,
    explanation: "Persebaya Surabaya dan Arema FC adalah rival Jawa Timur Madura.",
  },
  {
    id: "t7",
    category: "trivia",
    prompt: "Prestasi terbaik Madura United di Liga 1 adalah...",
    options: ["Juara Liga 1", "Runner-up", "Peringkat 3", "Juara Piala Presiden"],
    answerIndex: 1,
    explanation: "Madura United pernah menjadi runner-up Liga 1 musim 2019/2020 (sebelum dihentikan).",
  },
  {
    id: "t8",
    category: "trivia",
    prompt: "Pelatih yang membawa Madura United ke posisi runner-up Liga 1 2019 adalah...",
    options: ["Rahmad Darmawan", "Dejan Antonic", "Robert Alberts", "Djadjang Nurdjaman"],
    answerIndex: 0,
    explanation: "Rahmad Darmawan pernah menukangi Madura United di era itu.",
  },
];

export function pickQuestions(cat: Category | "all", count: number): Question[] {
  const pool = cat === "all" ? QUESTIONS : QUESTIONS.filter((q) => q.category === cat);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export const BACKGROUNDS = {
  stadium: IMG.stadium,
  jersey: IMG.jersey,
  trophy: IMG.trophy,
};
