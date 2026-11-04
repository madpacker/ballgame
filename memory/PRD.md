# Cak Mad Quiz — PRD

## Loop retensi
- **Harian**: Streak + bonus poin + papan "🔥 Juara Streak Hari Ini".
- **Mingguan**: Theme Challenge + Leaderboard mingguan + Badge 🥇🥈🥉 + Skin CHAMPION 👑.
- **Social**: Follow via `MU-XXXXXX` + Notifikasi + Rematch Challenge (`cakmad://`).
- **Live Match**: Banner LIVE + bonus 2x saat Madura main.
- **Prediksi**: Skor + Pencetak Gol + MOTM dengan poin terpisah.
- **Celebration**: Terompet 📯 saat rekor skor baru.
- **Admin branding**: Custom background global + info & 4 media sosial (IG, TikTok, WA, YouTube).
- **Berita**: Admin posting artikel (judul, cover, body); user baca list + detail dengan pull-to-refresh.
- **Soal admin-driven**: Semua `QUESTIONS` bawaan dihapus. Admin kelola Trivia Klub (format tebak gambar) & kategori baru Garuda Call via `/admin/quiz-items` dengan toggle ON/OFF per soal.

## Skema Poin Prediksi
- 🎯 Tepat skor: **+300**
- ⚽ Benar pemenang: **+100**
- 🥅 Tebak pencetak gol (termasuk salah satu dari multi scorer): **+150**
- 🏆 Tebak MOTM (Man of the Match): **+200**
- Maksimal per laga: **+650 poin**

## Backend (FastAPI + MongoDB) — prefix `/api`
- Auth, scores (+streak +live_bonus), skins, weekly-theme, leaderboard (global/friends/weekly), friends, notifications, badges, challenges, players, admin, files
- Streak board: `GET /top-streaks`
- Match & Prediksi: `GET /matches`, `GET /live-match`, `POST /matches/{id}/predict` (now with scorer_player_id + motm_player_id), `GET /me/prediction/{id}`, `GET /predictions/leaderboard`, `POST /admin/matches/{id}/result` (now with scorer_player_ids list + motm_player_id)
- App settings: `GET /app-settings`, `PUT /admin/app-settings` (description + socials), `POST/DELETE /admin/app-settings/background`
- Berita: `GET /news`, `GET /news/{id}`, `POST /admin/news` (multipart), `PUT/DELETE /admin/news/{id}`
- Soal Quiz (Trivia & Garuda): `GET /quiz-items?category=...`, `GET/POST /admin/quiz-items`, `PUT/DELETE /admin/quiz-items/{id}`, `POST /admin/quiz-items/{id}/image`, `POST /admin/quiz-items/reorder`
- Berita Sosial: `POST /news/{id}/like` (toggle), `GET/POST /news/{id}/comments` (threaded + mentions), `DELETE /news/comments/{id}` (owner atau admin)
- Mention: `GET /users/search?q=...` (public, max 8 hasil, prefix name/short_code)
- Impor Soal: `POST /admin/quiz-items/import` (multipart CSV: prompt, option_a..d, answer_index, active?, image_url?)
- Database Timnas: seeded 84 pemain era 2010-2026 via `backend/seed_timnas.py` (foto dari Transfermarkt CDN)

## Testing
**253/253 pytest green** (176 iter9 + 24 iter10 + 21 iter11 + 24 iter12 + 8 iter13) di `/app/backend/tests/`.

## Update (Oct 2026) — Tournament + Classic Kumulatif
- Tournament mode: admin toggle (PUT /api/admin/tournament), locked button when OFF.
  - Classic (t_classic): 20 soal campuran (Tebak Pemain+Trivia+Garuda), 20 dtk/soal, 100 + 5/dtk sisa; leaderboard KUMULATIF.
  - Time Attack (t_time_attack): 90 dtk, 100/benar, leaderboard HIGH SCORE.
  - Royal: misi harian (like 5x5, komentar 10x3, main Classic 10x3, main TA 5x3, video 20x1 setelah admin approve), leaderboard Royal.
  - Endpoints: /api/tournament/status|me|leaderboard, /api/royal/videos, /api/admin/royal/videos[/id/review].
- Normal Classic leaderboard now CUMULATIVE (best_scores $inc, games count); weekly classic = sum of week. One-time migration summed past classic scores.
- Anti-cheat: POST /api/games/start returns one-time game_id required by POST /api/scores (409 on reuse); score/correct/total validated & capped.
- Min play time enforced on /scores (classic ≥0.8s/question, TA ≥50s, T-TA ≥80s). TA total now counts answered questions.
- Backlog: challenge completion (/challenges/{id}/complete) not yet ticket-protected.
- Categories: trivia (label "Madura United"), garuda, liga, bali, persebaya, persib, persija (CSV per category). Tebak Pemain/Sejarah Pemain removed; player photos migrated into trivia (players_to_trivia_v1). Admin category logos (/api/admin/category-logo/{k}).
- Category screen: stadium neon redesign. Match result button always available (HASIL/UBAH), re-scoring predictions.
- Home redesigned as game lobby (profile bar + level/XP from /api/me/xp, 500 XP per level, bento grid, BottomNav: Leaderboard/Prediksi/Berita/Store/Profil + MULAI). Art slots in src/data/homeArt.ts (awaiting owner images). /store = coming soon (awaiting owner design).
- Pengaturan Profil (/settings): name edit + avatar upload (once/7 days), custom name/photo kept across Google logins.
- Game Store (/store): admin Futcards (photo, price, stock) redeemed with XP balance (xp - xp_spent; level unaffected), one per user; owned cards in Profile "KOLEKSI KARTU". Profile redesigned (stadium/glass).

- Tournament: admin category toggles (tournament_categories) + RESET all boards (archived to tournament_archives, royal_points=0). Admin gifts Futcards to users (/api/admin/users/{id}/gift-card) -> profile collection.
- Football 100 (/f100): 10 Qs, 30s each, 4 ordered slots + 8 options; perfect order=100, else 10/hit; server-scored via /api/f100/start|submit; cumulative leaderboard /f100/leaderboard (attempts, time, accuracy); admin CRUD + CSV (prompt, answer_1..4, wrong_1..4). Counts toward XP.
