# Cak Mad Quiz — PRD

## Purpose
Mobile fan quiz game for Madura United (Liga 1 Indonesia). Players answer trivia across three categories and compete on a global leaderboard.

## Modes
- **Classic**: 10 soal, poin akurasi (100 per benar).
- **Time Attack**: 60 detik, jawab sebanyak mungkin.

## Categories
- `guess` — Tebak foto pemain.
- `history` — Dari klub mana pemain berasal.
- `trivia` — Sejarah & fakta klub.
- `all` — Campuran.

## Features
- Dark theme with Madura United red (`#C8102E`) + gold (`#D4AF37`).
- Local high score per mode (AsyncStorage).
- Global leaderboard with Google login (Emergent managed auth).
- Share hasil skor via native Share API.
- Correct/Wrong flash animation + haptics.

## Backend (FastAPI + MongoDB)
Routes prefixed `/api`.
- `POST /auth/session`, `GET /auth/me`, `POST /auth/logout`
- `POST /scores` — append to `scores`, upsert best per user+mode in `best_scores`.
- `GET /leaderboard?mode=` — top 50 from `best_scores`.

## Frontend (Expo Router)
- `/` Home (hero + high score + mode CTAs)
- `/category` category picker (receives `mode`)
- `/quiz` gameplay (receives `mode`, `category`)
- `/result` summary + share + submit
- `/leaderboard` global ranks per mode
- `/profile` user info + local stats
- `/login` Google sign-in gate

## Future
- Upload real player photos via Emergent Object Storage.
- Friends-only leaderboard tab.
- Push notification for new weekly challenges.
