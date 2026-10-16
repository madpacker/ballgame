# CMS Soal + Jersey Quiz + Dompet Poin Global

Panel admin untuk mengedit setiap soal quiz dan menambah kategori Jersey Quiz dengan foto. Setiap jawaban benar — di quiz, prediksi, streak, MOTM — masuk ke satu dompet poin global yang terlihat di profil dan leaderboard baru.

## Untuk siapa
Fans Madura United yang sudah pakai Cak Mad Quiz, admin pengelola konten, dan pemain kompetitif yang ingin mengukur total performa di satu angka.

## Fitur inti & pengalaman

**1. CMS Soal Quiz (Admin)**
- Halaman Admin dapat section baru "Database Soal" di bawah "Database Pemain".
- Admin bisa tambah / edit / hapus soal apa pun — termasuk soal bawaan yang sudah ada.
- Setiap soal: kategori (Tebak Pemain · Sejarah · Trivia · Jersey), pertanyaan (teks), 4 opsi jawaban, pilih jawaban benar, upload foto opsional, toggle aktif/non-aktif di quiz.
- List soal menampilkan preview + badge kategori; filter per kategori.
- Soal custom muncul otomatis di quiz, dicampur dengan soal otomatis dari pemain yang sudah ada.

**2. Jersey Quiz (kategori baru)**
- Kategori ke-5: Jersey Quiz, muncul di layar Category Selector.
- Dua jenis soal yang dicampur:
  - Tebak musim / jenis (home / away / third / edisi khusus) — admin upload foto jersey + pilih jawaban dari daftar.
  - Tebak nomor punggung — admin upload foto pemain pakai jersey + input nomor + 3 nomor pengecoh otomatis.
- Admin membuat soal Jersey lewat CMS Soal (jenis & field berubah mengikuti sub-tipe).

**3. Dompet Poin Global**
- Setiap jawaban benar menambah poin ke dompet pengguna:
  - Jawaban quiz benar: +10 poin dasar.
  - Prediksi skor tepat / pemenang / pencetak gol / MOTM: tetap pakai 300/100/150/200.
  - Streak harian: tetap +25/+75/+150 (sudah ada).
- Profil menampilkan **Dompet Poin** besar (angka emas) di atas statistik high score.
- Leaderboard baru di layar Leaderboard: chip scope ke-4 **"Poin"** di samping Global / Teman / Mingguan — menampilkan total dompet poin sepanjang masa.

**4. Live Match Mode**
- Tetap seperti sekarang. Tidak ditambah fitur live pick.

## Alur pengguna

**Admin membuat soal custom**
Buka Profil → Database Pemain & Soal (Admin) → tab "Soal" → tombol Tambah Soal → pilih kategori → isi pertanyaan + 4 opsi → centang jawaban benar → upload foto (opsional) → Simpan. Soal langsung aktif di quiz.

**Admin menambah soal Jersey**
Tambah Soal → kategori "Jersey" → pilih sub-tipe (musim/jenis atau nomor punggung) → upload foto jersey/pemain → isi jawaban → Simpan.

**Pengguna main quiz Jersey**
Beranda → Mode Classic/Time Attack → kategori "Jersey Quiz" → quiz berjalan seperti kategori lain, hanya soal jersey yang muncul.

**Pengguna lihat dompet poin**
Profil → kartu "Dompet Poin" tampil di bagian atas dengan angka besar emas. Leaderboard → tap chip "Poin" untuk melihat peringkat total poin sepanjang masa.

**Pengguna dapat poin otomatis**
Setiap jawab quiz benar: +10 ke dompet. Prediksi dinilai admin: poin prediksi masuk otomatis. Juara mingguan / streak milestone: poin bonus tetap mengalir ke dompet yang sama.

## UI/UX feel
- Tetap dark-first Madura United dengan merah `#C8102E` + emas `#D4AF37`.
- Kartu Dompet Poin di profil: latar emas gradasi lembut dengan angka serif besar untuk kesan trofi.
- Latar halaman admin CMS: pattern garis stadium halus warna gelap, biar bedakan dari halaman biasa.
- Tombol admin "Tambah Soal" memakai aksen emas, tombol destructive (hapus) ikonik tapi tidak dominan.
- Kategori Jersey Quiz di Category Selector: ikon kaos (tshirt) warna merah, tagline "Tebak jersey Laskar Sape Kerap".
- Scope chip "Poin" di leaderboard pakai ikon dompet, badge angka ringkas di samping nama user.
- Chip "+10" muncul singkat (fade) di layar quiz setiap kali user jawab benar — biar poin yang diraih kerasa.

## Fase implementasi
**Fase 1 (dibangun sekarang · MVP):**
- CMS soal: tambah / edit / hapus / toggle aktif untuk 4 kategori lama + Jersey Quiz, dengan upload foto.
- Jersey Quiz sebagai kategori ke-5 di quiz, dua sub-tipe soal.
- Dompet poin global: +10 per jawaban benar, aggregat poin prediksi / streak / badge, tampil di profil + chip "Poin" di leaderboard.
- Chip "+10" micro-animation di quiz saat jawaban benar.

**Fase 2 (nanti):**
- Bulk import soal via CSV untuk admin.
- Mode "Jersey Only" dengan leaderboard khusus kategori.
- Shop item yang bisa ditukar pakai poin (misal: unlock skin edisi khusus 500 poin).

**Fase 3 (nanti):**
- Draft soal (admin bisa simpan sebagai draft sebelum dipublish).
- Review komunitas: user bisa ajukan soal; admin approve sebelum masuk pool.
- Multi-admin dengan role (editor vs super admin).

## Asumsi
- Nilai poin dasar per jawaban benar quiz = **+10**. Nilai prediksi (300/100/150/200) dan streak (+25/+75/+150) tidak berubah.
- Soal custom boleh menimpa soal bawaan — admin bisa toggle include/exclude termasuk untuk soal yang dulunya hardcoded (akan dimigrasi ke DB saat Fase 1).
- Jersey Quiz tidak ikut challenge mingguan tematik (filter tema sudah kompleks); jersey hanya tampil saat user pilih kategori Jersey atau "Semua Kategori".
- Dompet poin menghitung ulang dari awal: skor historis quiz pre-MVP tidak retroaktif dikonversi ke poin (hanya skor baru + prediksi + streak sejak Fase 1 dirilis yang masuk).
- Upload foto pakai Emergent Object Storage yang sudah terkonfigurasi.
- Admin tetap satu peran (user pertama yang sign-in), promosi admin lain belum ada UI-nya di Fase 1.
- Soal lama (hardcoded di `src/data/quiz.ts`) tetap muncul sampai admin menonaktifkannya; akan diseed ke DB saat Fase 1 agar bisa diedit.
- Leaderboard "Poin" bersifat all-time, tidak ada versi mingguan untuk dompet poin (sudah ada Mingguan scope untuk high score).
