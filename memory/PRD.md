# Cak Mad Quiz — PRD

## Purpose
Mobile fan quiz game for Madura United. Daily habit loop via streak, weekly loop via themed challenge + champion skin, social loop via friends & notifications.

## Modes
- **Classic**: 10 soal, 100 poin per benar.
- **Time Attack**: 60 detik.

## Categories
`guess`, `history`, `trivia`, `all` — static bank + admin-seeded players + weekly-theme filter.

## Features
- 4 Jersey skins: HOME · AWAY · THIRD · **CHAMPION 👑** (eksklusif untuk juara 1 mingguan, aktif 7 hari).
- Local high score + global/teman/mingguan leaderboard scope.
- Weekly top-3 badge 🥇🥈🥉 + top-1 mendapat skin CHAMPION.
- **Daily streak** dengan bonus poin otomatis: +25 (streak 2), +75 (streak 3), +150 (streak 7+).
- **Weekly themed challenge** di beranda: 8 tema berotasi (Era Rahmad Darmawan, Legenda Striker, Tembok Pertahanan, Legiun Brasil, Jebolan Liga Indonesia, Jenderal Lini Tengah, Skuad Runner-Up 2019, Bintang Asing).
- Google login (Emergent), QR + kode `MU-XXXXXX`, follow via kode/email.
- In-app notifications (follow + juara mingguan + unlock champion).
- Admin screen: upload foto pemain + Seed Demo (18 pemain MU).
- Share hasil skor via native Share API.

## Backend (FastAPI + MongoDB) — prefix `/api`
- Auth: `POST /auth/session`, `GET /auth/me`, `POST /auth/logout`
- Scores: `POST /scores` (updates streak, triggers rollover) → returns `{score, streak, streak_bonus, streak_milestone}`
- Streak: `GET /me/streak`
- Skins: `GET /me/skins`
- Weekly Theme: `GET /weekly-theme`
- Leaderboard: `GET /leaderboard?mode=&scope=global|friends`, `GET /leaderboard/weekly?mode=`
- Friends: `GET /friends`, `GET /friends/search`, `POST /friends/follow`, `POST /friends/unfollow`
- Notifications: `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read-all`
- Badges: `GET /me/badges`
- Players: `GET /players`
- Admin: `POST /admin/players`, `PATCH /admin/players/{id}`, `DELETE /admin/players/{id}`, `POST /admin/seed-players`
- Files: `GET /files/{path}` (Emergent Object Storage)

## Testing
Backend: **78/78 pytest green** at `/app/backend/tests/test_cakmad_api.py`.
