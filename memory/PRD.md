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

## Testing
**245/245 pytest green** (176 iter9 + 24 iter10 + 21 iter11 + 24 iter12) di `/app/backend/tests/`.
