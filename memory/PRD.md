# Cak Mad Quiz — PRD

## Purpose
Mobile fan quiz game for Madura United (Liga 1 Indonesia). Players compete across quiz categories, follow each other, chase weekly badges, and personalize their quiz skin.

## Modes
- **Classic**: 10 soal, 100 poin per benar.
- **Time Attack**: 60 detik, jawab sebanyak mungkin.

## Categories
- `guess`, `history`, `trivia`, `all` — Static bank + dynamic from admin-seeded players.

## Features
- Dark theme Madura United (default red + gold).
- **3 Jersey skins** (`home` merah, `away` putih, `third` emas) — picked in Profile; applies to Home logo, mode icons, Start CTA, quiz option letter, and progress bar.
- Local high score per mode (AsyncStorage).
- Global, Teman, dan **Mingguan** scope leaderboard.
- Google login (Emergent managed), auto-generated `MU-XXXXXX` username + QR for sharing.
- Friends system: follow by code/email, unfollow, friends-only leaderboard.
- **In-app notifications**: muncul saat ada yang mem-follow + saat kamu juara 1/2/3 minggu lalu.
- **Weekly badges**: top-3 per mode tiap ISO week otomatis diberi piagam 🥇🥈🥉 saat week rollover.
- Admin screen: upload foto pemain (Emergent Object Storage), toggle include/exclude dari quiz, soft delete, dan tombol **Seed Demo** untuk mengisi 18 pemain MU asli (Beto, Odemwingie, Bayu Gatra, dll) sekaligus.
- Share hasil skor via native Share API.

## Backend (FastAPI + MongoDB)
Routes prefixed `/api`.
- **Auth**: `POST /auth/session`, `GET /auth/me`, `POST /auth/logout`
- **Scores**: `POST /scores` (tags `week_key`, triggers rollover)
- **Leaderboard**: `GET /leaderboard?mode=&scope=global|friends&limit=`, `GET /leaderboard/weekly?mode=&limit=`
- **Friends**: `GET /friends`, `GET /friends/search?q=`, `POST /friends/follow`, `POST /friends/unfollow`
- **Notifications**: `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read-all`
- **Badges**: `GET /me/badges`
- **Players**: `GET /players`
- **Admin**: `POST /admin/players`, `PATCH /admin/players/{id}`, `DELETE /admin/players/{id}`, `POST /admin/seed-players`
- **Files**: `GET /files/{path}` (Emergent Object Storage pass-through)

## Frontend (Expo Router)
`/`, `/category`, `/quiz`, `/result`, `/leaderboard`, `/friends`, `/notifications`, `/admin`, `/profile`, `/login`.

## Testing
Backend: **60/60 pytest green** (`/app/backend/tests/test_cakmad_api.py`).
