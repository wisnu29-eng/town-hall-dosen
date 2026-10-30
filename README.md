# Dashboard Live — Google Form → Google Sheets → GitHub Pages

Dashboard statis (HTML/CSS/JS) yang membaca data Google Form **langsung dari Google Sheets** lewat Apps Script, dan memperbarui diri setiap ~10 detik tanpa reload. Animasi memakai GSAP.

```
Google Form  →  Google Sheet  →  Apps Script Web App (JSON/JSONP)
                                        ↓  polling versi ~10 dtk
                                  GitHub Pages (dashboard)
```

- **Tanpa backend sendiri, tanpa database, tanpa API key.**
- **Tanpa CORS drama** — data dikirim sebagai JSONP.
- **Hemat kuota** — klien cek "versi" dulu; data penuh hanya diambil kalau ada perubahan.
- **Tahan kolom berubah** — skema ditebak otomatis dari header & tipe data.

---

## 1. Struktur folder

```
.
├── index.html                # halaman dashboard
├── assets/
│   ├── css/styles.css        # desain (light editorial)
│   └── js/
│       ├── config.js         # ← SATU-SATUNYA file yang perlu Anda ubah
│       ├── format.js         # format angka, tanggal, relatif
│       ├── api.js            # JSONP, polling, mode demo
│       ├── charts.js         # chart SVG + animasi GSAP
│       └── app.js            # orkestrasi data → DOM
├── apps-script/
│   ├── Code.gs               # API: doGet, ping, cache, trigger
│   └── appsscript.json       # manifest
├── .nojekyll                 # wajib untuk GitHub Pages
└── README.md
```

---

## 2. Pasang Apps Script (5 menit)

1. Buka spreadsheet respons Google Form Anda.
2. **Extensions → Apps Script**.
3. Hapus isi `Code.gs` bawaan, tempel seluruh isi `apps-script/Code.gs`. **Save**.
4. (Opsional) Di bagian `CONFIG`, isi `SHEET_NAME` bila data bukan di tab pertama.
5. **Deploy → New deployment → Web app**
   - Description: `dashboard`
   - **Execute as: Me**
   - **Who has access: Anyone**
6. Klik **Deploy** → **Authorize access** → pilih akun → *Advanced → Go to … (unsafe) → Allow*.
7. Salin URL yang berakhiran **`/exec`**.

### Pasang trigger (penting untuk "instan")

Di editor Apps Script, pilih fungsi **`installTriggers`** dari dropdown → **Run** (sekali saja).
Ini membuat trigger `onFormSubmit` yang menaikkan versi data begitu ada respons baru, sehingga dashboard tahu harus menarik data — biasanya dalam < 10 detik.

> Alternatif: dari spreadsheet, menu **Dashboard → Pasang trigger form submit**.

Setelah semua terpasang, menu **Dashboard** di spreadsheet punya:
| Menu | Fungsi |
|---|---|
| Salin URL API | menampilkan URL `/exec` |
| Pasang trigger form submit | membuat trigger realtime |
| Kosongkan cache | paksa data segar |
| Cek koneksi API | menampilkan sheet, jumlah baris, versi |

---

## 3. Sambungkan dashboard

Buka `assets/js/config.js`, isi satu baris:

```js
API_URL: "https://script.google.com/macros/s/AKfycb.../exec",
```

Simpan, buka `index.html` di browser. Banner "MODE DEMO" akan hilang dan data asli muncul.

**Uji cepat:** buka URL `/exec` di tab baru — harus muncul JSON. Tambahkan `?action=ping` untuk melihat versi ringan.

---

## 4. Publikasikan ke GitHub Pages

```bash
git init
git add .
git commit -m "feat: live gsheet dashboard"
git branch -M main
git remote add origin https://github.com/USERNAME/NAMA-REPO.git
git push -u origin main
```

Lalu di GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / root → Save**.

Situs tersedia di `https://USERNAME.github.io/NAMA-REPO/` setelah ±1 menit.

> `.nojekyll` sudah disertakan agar folder `assets/` tidak diproses Jekyll.

---

## 5. Kustomisasi

Semua di `assets/js/config.js`:

| Kunci | Arti |
|---|---|
| `TITLE`, `LEDE`, `EYEBROW_LIVE` | teks judul & narasi |
| `POLL_MS` | interval cek data (default 10000) |
| `COLUMNS` | paksa pemetaan kolom, mis. `{ date: "Timestamp", rating: "Kepuasan", category: "Produk", region: "Kota" }` |
| `PALETTE` | warna kategori (urutan aman buta warna) |
| `LOCALE`, `NUMBER_DECIMALS` | format angka |
| `RECENT_COUNT`, `TABLE_ROWS` | jumlah baris kartu & tabel |

Gaya visual: `assets/css/styles.css`, semua warna ada di blok `:root`.

### Bagaimana kolom dipilih otomatis?

1. **Tanggal** → kolom bertipe datetime (prioritas nama: `timestamp`, `waktu`, `tanggal`).
2. **Nama** → kolom teks bernama `nama`, `name`, `responden`, `email`.
3. **Rating** → kolom angka 2–11 nilai unik, prioritas nama `rating`, `skor`, `kepuasan`, `nps`.
4. **Kategori** → kolom teks dengan 2–24 nilai unik dan teks pendek.
5. **Wilayah** → kolom teks bernama `kota`, `lokasi`, `provinsi`, `region`.

Kalau tebakan meleset, kunci dengan `COLUMNS`.

---

## 6. Cara kerja animasi

| Elemen | Animasi |
|---|---|
| Judul hero | mask-reveal + underline swipe (CSS) |
| KPI | angka berjalan (`countTo`) dengan `power2.out`, kartu stagger |
| Grafik tren | garis digambar via `stroke-dashoffset`, area via clip-path, titik puncak berdenyut |
| Bar peringkat | lebar + label angka bergerak bersama (`stagger 0.06`) |
| Komposisi | segmen melebar berurutan, legenda fade-in |
| Respons baru | baris meluncur masuk + flash oranye + tag `baru` |
| Data berubah | kartu utama di-pulse, KPI menghitung ulang |

`prefers-reduced-motion` dihormati: semua animasi dimatikan otomatis.

---

## 7. Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| Banner "MODE DEMO" terus muncul | `API_URL` kosong | isi `API_URL` di config.js |
| JSON tampil tapi dashboard kosong | sheet pertama bukan data | isi `CONFIG.SHEET_NAME` |
| Error `Spreadsheet tidak ditemukan` | script tidak terikat | isi `CONFIG.SPREADSHEET_ID` |
| Data tidak berubah setelah submit | trigger belum ada | Run `installTriggers` |
| Data telat ±20 detik | cache server | normal; turunkan `CACHE_SECONDS` |
| `Authorization required` | deployment bukan "Anyone" | Deploy ulang, ubah akses |
| Grafik datar di 0 | kolom tanggal tidak terdeteksi | set `COLUMNS.date` |

**Cek cepat backend:** buka `/exec?action=ping` — harus `{"ok":true,"v":"…"}`.

---

## 8. Keamanan & batasan

- Akses **Anyone** berarti siapa pun yang punya URL `/exec` bisa membaca data. **Jangan pakai untuk data sensitif** (email pribadi, nomor HP, data kesehatan). Kalau perlu, tambahkan token di `doGet` dan kirim lewat parameter.
- Kuota Apps Script gratis: 20.000 `UrlFetch`/hari, 6 menit per eksekusi. Dashboard ini hanya membaca sheet, jadi sangat ringan.
- Cache dibatasi ±20 detik; untuk data > 20.000 baris naikkan `MAX_ROWS` dengan hati-hati (batas cache 100KB per key sudah ditangani dengan chunk).
- Data di sheet tetap milik Anda; dashboard hanya membaca.

---

## 9. Menjalankan lokal

Cukup buka `index.html` — tidak butuh build step. Untuk pengembangan:

```bash
npx serve .
# atau
python -m http.server 8080
```

Selama `API_URL` kosong, dashboard memakai **mode demo**: data sintetis yang bertambah tiap ~30 detik supaya semua animasi bisa dilihat.

---

Dibangun dengan Apps Script + GSAP 3. Tanpa framework, tanpa build, tanpa dependensi backend.
