# Cak Mad Quiz — PRD

## Purpose
Mobile fan quiz game for Madura United (Liga 1 Indonesia). Players answer trivia across three categories, follow friends, and compete on a global leaderboard. Admin can curate the player database with real photos.

## Modes
- **Classic**: 10 soal, poin akurasi (100 per benar).
- **Time Attack**: 60 detik, jawab sebanyak mungkin.

## Categories
- `guess` — Tebak foto pemain (auto-generated from players collection + static bank).
- `history` — Dari klub mana pemain berasal.
- `trivia` — Sejarah & fakta klub.
- `all` — Campuran.

## Features
- Dark theme Madura United red (#C8102E) + gold (#D4AF37).
- Local high score per mode (AsyncStorage).
- Global leaderboard + **Friends scope** with Google login (Emergent managed).
- **Friends system**: auto-generated `MU-XXXXXX` username code, QR code display, follow by code/email, friends-only leaderboard tab.
- **Admin screen**: first registered user becomes admin → can upload player photos (name, position GK/DEF/MID/FWD, years_at_mu, previous_clubs). Players feed the quiz automatically; toggle to pause from quiz pool; soft delete.
- Share hasil skor via native Share API.

## Backend (FastAPI + MongoDB)
Routes prefixed `/api`.
- **Auth**: `POST /auth/session`, `GET /auth/me`, `POST /auth/logout`
- **Scores**: `POST /scores` (append + upsert best in `best_scores`)
- **Leaderboard**: `GET /leaderboard?mode=&scope=global|friends&limit=`
- **Friends**: `GET /friends`, `GET /friends/search?q=`, `POST /friends/follow {code|email}`, `POST /friends/unfollow`
- **Players (public read)**: `GET /players?include_all=`
- **Admin players**: `POST /admin/players` (multipart), `PATCH /admin/players/{id}?included_in_quiz=`, `DELETE /admin/players/{id}` (soft delete)
- **Files**: `GET /files/{path}` serves images from Emergent Object Storage

## Frontend (Expo Router)
- `/` Home (hero + high score + mode CTAs)
- `/category` category picker
- `/quiz` gameplay (dynamic player bank)
- `/result` summary + share + submit
- `/leaderboard` global/friends × classic/time_attack
- `/friends` QR code + add teman via kode/email + follow list
- `/admin` player CRUD (gated by `is_admin`)
- `/profile` user info + stats + admin shortcut
- `/login` Google sign-in gate

## Testing
Backend: 38/38 pytest green (`/app/backend/tests/test_cakmad_api.py`).
