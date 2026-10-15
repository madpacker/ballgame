# Cak Mad Quiz — PRD

## Loop retensi
- **Harian**: Streak + bonus poin otomatis (+25/+75/+150).
- **Mingguan**: Challenge Tema berotasi + Leaderboard mingguan + Badge 🥇🥈🥉 + Skin CHAMPION 👑 7 hari.
- **Social**: Follow via kode `MU-XXXXXX`/email + Notifikasi + **Rematch Challenge link**.
- **Celebration**: Suara terompet 📯 saat kena rekor skor baru.

## Backend (FastAPI + MongoDB) — prefix `/api`
- Auth: `/auth/session`, `/auth/me`, `/auth/logout`
- Scores: `POST /scores` → returns `{score, streak, streak_bonus}`
- Streak & Skins: `GET /me/streak`, `GET /me/skins`
- Weekly Theme: `GET /weekly-theme`
- Leaderboard: `GET /leaderboard?scope=global|friends`, `GET /leaderboard/weekly`
- Friends: `GET /friends`, `GET /friends/search`, `POST /friends/follow`, `POST /friends/unfollow`
- Notifications: `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read-all`
- Badges: `GET /me/badges`
- Challenges: `POST /challenges/create`, `GET /challenges/{id}` (public), `POST /challenges/{id}/complete`
- Players: `GET /players`
- Admin: `POST /admin/players`, `PATCH/DELETE /admin/players/{id}`, `POST /admin/seed-players`
- Files: `GET /files/{path}` (Emergent Object Storage)

## Frontend (Expo Router)
`/`, `/category`, `/quiz`, `/result`, `/leaderboard`, `/friends`, `/notifications`, `/admin`, `/profile`, `/login`, `/challenge/[id]`.

## Testing
**94/94 pytest green** di `/app/backend/tests/test_cakmad_api.py`.
