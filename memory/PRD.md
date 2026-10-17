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

## Testing
**176/176 pytest green** di `/app/backend/tests/` (+19 iter9 tests).
