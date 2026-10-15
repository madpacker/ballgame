# Cak Mad Quiz — PRD

## Loop retensi
- **Harian**: Streak + bonus poin + papan "🔥 Juara Streak Hari Ini" di beranda.
- **Mingguan**: Challenge Tema + Leaderboard mingguan + Badge 🥇🥈🥉 + Skin CHAMPION 👑 7 hari.
- **Social**: Follow via kode `MU-XXXXXX`/email + Notifikasi + **Rematch Challenge link** (web + deep link `cakmad://`).
- **Celebration**: Suara terompet 📯 saat rekor skor baru.

## Deep Link
- Scheme `cakmad://` di `app.json` — route `/challenge/[id]` otomatis bisa dibuka via `cakmad://challenge/ch_xxx` setelah user install `.apk`/.ipa build.

## Backend (FastAPI + MongoDB) — prefix `/api`
- Auth, scores, streak, skins, weekly-theme, leaderboard (global/friends/weekly), friends, notifications, badges, challenges (create/get/complete), players, admin, files.
- `GET /top-streaks?limit=N` — public leaderboard streak harian.

## Testing
**108/108 pytest green** di `/app/backend/tests/test_cakmad_api.py`.
