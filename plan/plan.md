# Admin Pengelola Bank Soal

Admin dapat membuat, mengubah, dan menghapus seluruh pertanyaan quiz Cak Mad Quiz dari dalam aplikasi, termasuk kategori baru Tebak Jersey. Bank soal bawaan hard-coded diganti sepenuhnya oleh soal buatan admin.

## Target pengguna
- **Admin aplikasi** (user pertama yang sign-in, atau user yang di-promote jadi admin lewat DB). Admin dari komunitas fans Madura United yang punya pengetahuan mendalam tentang klub.
- Pengguna biasa hanya menikmati hasilnya — mereka tidak melihat UI admin ini sama sekali.

## Fitur inti dan pengalaman
- **CRUD pertanyaan penuh**: tambah pertanyaan baru, ubah pertanyaan yang sudah ada, soft-delete, toggle included_in_quiz (sama polanya seperti pengelolaan pemain).
- **Empat kategori**:
  - `history` — Sejarah Pemain (dari klub mana pemain berasal)
  - `trivia` — Trivia Klub (sejarah, prestasi, stadion, pemilik, dll)
  - `guess` — Tebak Pemain (otomatis tergenerate dari database pemain, admin masih bisa override di sini juga)
  - `jersey` — **Tebak Jersey (kategori baru)** — pertanyaan berbasis foto jersey (home/away/third/edisi khusus)
- **Isi tiap pertanyaan**:
  - Teks pertanyaan (contoh "Ini jersey Madura United musim berapa?")
  - 4 opsi jawaban
  - Index jawaban benar
  - Penjelasan singkat (opsional, muncul kalau user ingin tahu alasan)
  - Upload gambar (opsional; wajib untuk kategori jersey, bebas untuk kategori lain)
  - Tag "tema minggu ini" (opsional, kalau diisi hanya muncul saat tema yang cocok sedang aktif)
- **Bank soal bawaan dihapus**: 19 soal hard-coded di `src/data/quiz.ts` tidak lagi dipakai di produksi. Quiz hanya memakai soal dari database yang diinput admin + auto-generate dari pemain (untuk kategori guess & history). Kalau admin belum input apa-apa, muncul empty state "Admin belum menambah pertanyaan".
- **Seed soal awal**: tombol di admin screen untuk sekali-klik memasukkan 19 soal bawaan sebagai starting point, supaya admin tidak mulai dari nol. Admin bisa edit/hapus setelahnya.
- **Preview pertanyaan**: sebelum simpan, admin lihat kartu pertanyaan persis seperti yang akan user lihat di quiz, agar yakin tata letak dan jawabannya benar.

## Alur pengguna (admin)
1. Admin buka halaman Admin lewat profil → tap tab baru **"Pertanyaan Quiz"** (sebelahnya tab Pemain dan Jadwal Pertandingan)
2. Lihat daftar semua pertanyaan dengan filter kategori (chip horizontal: Semua / Sejarah / Trivia / Jersey / Tebak Pemain)
3. Tap **TAMBAH PERTANYAAN** → modal form (gambar opsional di paling atas, lalu pertanyaan, 4 opsi, radio jawaban benar, penjelasan, pilih kategori, tag tema)
4. Preview di bawah form berubah real-time saat admin mengetik → tap **SIMPAN**
5. Pertanyaan muncul di daftar; tap row → modal edit; tap trash → soft-delete; tap toggle → aktif/nonaktif di pool quiz
6. Kalau bank soal masih kosong, muncul banner "Mulai dari 19 soal demo" → sekali klik, 19 soal bawaan masuk ke DB; admin bisa langsung edit.

## UI/UX feel
- Tetap dark theme merah Madura (Home skin default) biar konsisten dengan rest of app.
- Admin screen pakai tab bar di dalamnya untuk tiga section besar: **Pemain** · **Jadwal** · **Pertanyaan** — scroll vertikal panjang berganti jadi tab yang lebih mudah dinavigasi.
- Form input memakai pattern yang sama dengan form Tambah Pemain supaya admin tidak perlu belajar UI baru.
- Modal preview memakai persis komponen quiz card yang user lihat — gambar + prompt + 4 opsi berjejer vertikal dengan huruf A/B/C/D.
- Chip filter kategori di baris horizontal 36pt (sticky header, tidak wrap, scroll ke kanan untuk lihat semua).
- Tombol upload gambar sama persis pattern dengan form pemain (tap area dashed → image picker).
- Empty state punya ilustrasi + CTA "Seed 19 soal demo" supaya admin bootstrap cepat.

## Fase implementasi
**Fase 1 — MVP (dibangun sekarang)**
- CRUD pertanyaan untuk kategori: history, trivia, jersey (kategori baru).
- Upload gambar via Emergent Object Storage, sama infrastruktur dengan foto pemain.
- Tab bar di dalam Admin screen: Pemain · Jadwal · Pertanyaan.
- Modal tambah/edit dengan live preview.
- Seed button "Mulai dari 19 soal demo" (sekali klik idempotent).
- Quiz runtime beralih sepenuhnya ke bank DB; fallback hanya ke auto-generated players kalau DB kosong.
- Toggle included_in_quiz + soft delete.

**Fase 2 — Enhancement**
- Bulk import pertanyaan via CSV upload (admin siapkan Excel, upload sekali, 50 soal masuk).
- Statistik tingkat kesulitan per soal (persentase user yang jawab benar) di admin dashboard.
- Pertanyaan versi musiman (tanggal mulai/berakhir), misal soal spesial Ramadhan atau peringatan ulang tahun klub.
- Preview quiz full flow di admin (lihat 10 soal classic sebelum di-publish).

**Fase 3 — Community & scale**
- Crowdsource: user biasa bisa submit pertanyaan, admin approve/reject.
- Reward poin untuk kontributor pertanyaan yang disetujui.
- Multi-admin: beberapa admin bisa punya role berbeda (editor, moderator).
- Translasi soal (ID/EN/Madura).

## Asumsi
- Kategori baru `jersey` hidup berdampingan dengan `guess` (Tebak Pemain) — bukan menggantikan. Jersey khusus foto jersey, guess khusus foto pemain.
- Quiz runtime di `src/data/questions.ts` diubah: tidak lagi menggabung static bank + dynamic players. Hanya pakai pertanyaan DB + fallback ke auto-generated players (karena ini adalah hasil dari data pemain yang juga dikelola admin).
- Weekly Challenge Theme tetap pakai mekanisme filter yang sama (position/years/previous_club/foreign) berbasis pemain. Kalau admin pasang tag tema di pertanyaan, itu jadi mekanisme kedua: pertanyaan dengan tag tema cocok akan diprioritaskan saat tema aktif.
- Setelah seed demo diklik sekali, tombolnya nonaktif (idempotent lewat nama unik atau flag di DB) biar admin tidak dobel-dobel.
- Soft delete sama pattern dengan pemain — `deleted_at` field, bukan hapus fisik, supaya bisa dipulihkan kalau salah hapus.
- Jersey questions tanpa foto masih bisa disimpan (misal "Warna away kit Madura United musim 2020 adalah?") tapi UI mengingatkan "Pertanyaan jersey biasanya butuh foto".
- Admin screen akan jadi lebih panjang; tab bar internal dipilih supaya tidak scroll panjang dan admin cepat pindah antar section.
- Tidak ada migrasi otomatis dari 19 soal hardcoded ke DB saat deploy pertama; admin yang kontrol kapan mau klik seed. Ini memberi admin kesempatan mulai dari slate kosong kalau mau soal custom semua.
- Pertanyaan Tebak Pemain (`guess`) di DB bersifat opsional. Kalau admin tidak mengisi, kategori ini tetap tersedia dari auto-generate pemain yang punya foto.
- Preview pertanyaan tidak menjalankan logic jawaban (hanya tampilan statis), karena admin sudah menandai jawaban benar.
