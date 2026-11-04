# Survey Town Hall Meeting Dosen

Platform survei dua layar untuk Town Hall Meeting:

- **Peserta** — `index.html`: satu pertanyaan pada satu waktu, anonim, tanpa nama/email.
- **Host** — `host.html`: PIN-gated, mengendalikan alur *buka pertanyaan → tampilkan hasil →
  lanjut*, dengan angka dan grafik yang diperbarui realtime.

Alurnya mengikuti rapat: host membuka pertanyaan, dosen menjawab, host menampilkan hasil
untuk dibahas, lalu lanjut ke pertanyaan berikutnya. Setelah pertanyaan terakhir, host
mendapat ringkasan sesi.

**Live:** https://wisnu29-eng.github.io/town-hall-dosen/

| Halaman | URL |
| --- | --- |
| Peserta | `/index.html` (atau `/`) |
| Host | `/host.html` — PIN default `1234` |
| Demo peserta | `/index.html?demo=1` |
| Demo host | `/host.html?demo=1&pin=1234` |

## Pertanyaan

Enam pertanyaan sesuai Google Form, dibahas berurutan:

1. **Kurikulum** — skala 1–6
2. **RPS** — skala 1–6
3. **Metode pembelajaran** — skala 1–6
4. **LMS** — skala 1–5 (mengikuti formulir)
5. **Literatur** — skala 1–6
6. **Aktivitas yang dikurangi** — pilih satu dari 5 opsi

Skala 1–6: Sangat Tidak Penting → Sangat Penting. Teks lengkap ada di
`assets/js/questions.js`.

## Struktur

```
index.html               ← layar peserta
host.html                ← layar host (PIN)
assets/css/styles.css    ← peserta + host, Swiss/IKB, responsif
assets/js/config.js      ← SATU-SATUNYA file yang perlu diubah saat deploy
assets/js/questions.js   ← teks pertanyaan, skala, opsi
assets/js/format.js      ← utilitas format angka/teks
assets/js/api.js         ← JSONP ke Apps Script, polling, deteksi demo
assets/js/demo.js        ← backend demo (localStorage) + simulasi jawaban
assets/js/participant.js ← alur layar peserta
assets/js/host.js        ← alur, rail pertanyaan, grafik, PIN
apps-script/Code.gs      ← tempel ke Apps Script
apps-script/appsscript.json
```

## Deploy

### 1. Apps Script

1. Buka spreadsheet tujuan (boleh spreadsheet Google Form lama) → **Extensions → Apps Script**.
2. Hapus isi `Code.gs`, tempel seluruh isi `apps-script/Code.gs`.
3. Sesuaikan bila perlu:
   - `HOST_PIN` — ganti dari `1234`.
   - `RESPONSES_SHEET` — nama tab jawaban (default `Survei Town Hall`, dibuat otomatis).
4. **Deploy → New deployment → Web app**
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
5. Salin URL yang berakhiran `/exec`.

Jika Web App sudah pernah di-deploy: **Deploy → Manage deployments → ✏️ → Version:
New version → Deploy**. URL tetap sama, jadi `API_URL` tidak perlu diubah.

Jawaban ditulis ke tab `Survei Town Hall` dengan kolom:

| Waktu | RespondentID | Kode | Pertanyaan | Jawaban | Nilai |
| --- | --- | --- | --- | --- | --- |

`RespondentID` adalah UUID acak di localStorage peserta — tidak ada nama, email, atau IP.

Ganti PIN kapan saja lewat menu **Survey Town Hall → Atur PIN host** di spreadsheet
(disimpan di Script Properties, menimpa `HOST_PIN`). Menu juga menyediakan
**Hapus semua jawaban** dan **Lihat URL web app**.

### 2. GitHub Pages

1. Salin URL `/exec` ke `API_URL` di `assets/js/config.js`.
2. Commit & push. GitHub Pages menyajikan `index.html` dan `host.html` dari root.
3. Buka `host.html`, masukkan PIN, lalu tampilkan layar host (proyektor) dan bagikan QR
   peserta yang muncul di rail kiri.

Tidak ada build step dan tidak ada dependensi lokal selain CDN QR Code (qrcodejs).

## Mode demo

Demo aktif otomatis saat halaman dibuka dari `localhost`, `127.0.0.1`, atau `file://`,
atau dipaksa dengan `?demo=1`. Tidak ada backend yang dipanggil; jawaban disimpan di
localStorage dan jawaban peserta disimulasikan agar grafik host bergerak.

- Reset data demo: `?demo=1&reset=1`
- PIN demo: `1234`
- Paksa live di localhost (uji backend asli): `?demo=0`
- Key localStorage: `th_survey_demo_v3`
- Matikan simulasi: `DEMO_AUTOFILL: false` di `config.js`

## Konfigurasi (`assets/js/config.js`)

| Kunci | Arti |
| --- | --- |
| `API_URL` | URL Web App Apps Script (`/exec`). Kosong = demo. |
| `RESPONSES_SHEET` | Nama tab jawaban. |
| `DEMO` | `true` / `false` / `null` (otomatis per hostname). |
| `DEMO_AUTOFILL` | Simulasi jawaban di mode demo. |
| `POLL_MS_PARTICIPANT` | Polling peserta (default 10000 ms). |
| `POLL_MS_HOST` | Polling host (default 3000 ms). |
| `JOIN_URL` | URL/QR peserta. Kosong = `index.html` otomatis. |
| `TITLE`, `SUBTITLE`, `ORG` | Teks yang tampil. |
| `LOCALE` | Format angka, default `id-ID`. |

## Catatan operasional

- **Host**: tombol di panel kanan — *Tampilkan hasil ke peserta*, *Pertanyaan berikutnya*,
  *Sembunyikan hasil*, *Buka lagi untuk jawaban*. Klik pertanyaan di rail kiri untuk
  lompat; `R` menampilkan/menyembunyikan hasil, `←` `→` pindah pertanyaan.
- **Peserta**: jawaban tidak bisa diubah setelah dikirim. Satu jawaban per
  `RespondentID` per pertanyaan; kiriman ganda diabaikan server.
- **Sesi baru** menghapus semua jawaban (dengan konfirmasi) dan mengembalikan sesi ke
  *Belum dimulai*.
- **Skala 200 peserta**: peserta memanggil Apps Script tiap 10 detik (host 3 detik),
  dengan variasi acak ±20% agar tidak membanjiri server bersamaan. Saat sesi belum
  dimulai polling peserta melambat ke 15 detik, dan 30 detik setelah sesi selesai.
  Artinya perubahan dari host terlihat di layar peserta dalam **±10 detik** — beri
  jeda singkat sebelum mengharapkan jawaban.
- **Kuota**: cache agregat 2 detik + pembaruan inkremental per jawaban membuat
  polling tidak membaca ulang seluruh sheet. Untuk acara lebih dari ~2 jam atau
  lebih dari 300 peserta, naikkan `POLL_MS_PARTICIPANT` ke 15000.
- **Keamanan**: PIN host hanya dikirim ke Apps Script dan diverifikasi di server; halaman
  host menyimpannya di `sessionStorage`. Peserta tidak pernah menerima data host.
- **Teks pertanyaan ada di dua tempat** — `assets/js/questions.js` (tampilan) dan
  `QUESTIONS` di `apps-script/Code.gs` (validasi jawaban). Ubah keduanya bersamaan.

## Troubleshooting

| Gejala | Penyebab / solusi |
| --- | --- |
| Peserta menampilkan "Backend belum mendukung mode survei" | `Code.gs` lama masih ter-deploy. Deploy ulang Web App dan perbarui `API_URL`. |
| PIN selalu salah | PIN di Script Properties berbeda dari yang diketik. Jalankan menu *Atur PIN host* atau hapus properti `HOST_PIN`. |
| Grafik host tidak bergerak | Peserta belum menjawab, atau polling gagal (cek banner koneksi). Di mode demo, pastikan `DEMO_AUTOFILL` aktif. |
| Jawaban tidak masuk | Sesi belum dibuka, atau pertanyaan sudah berganti saat peserta mengirim. Peserta cukup memuat ulang. |
| QR tidak muncul | CDN qrcodejs diblokir; tautan peserta tetap tercetak di bawah QR. |
