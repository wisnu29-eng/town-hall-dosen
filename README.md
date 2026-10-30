# Town Hall Meeting Dosen — Hasil Langsung

**Live:** https://wisnu29-eng.github.io/town-hall-dosen/

Halaman hasil survei bergaya dek presentasi (Swiss / IKB), membaca langsung dari
Google Sheets. Setiap kiriman Google Form muncul tanpa refresh dan tanpa ekspor
manual.

- **Tampilan**: satu slide per pertanyaan, angka besar, histogram, peringkat pilihan,
  pindah otomatis tiap 12 detik, navigasi `←` `→`, spasi untuk jeda.
- **Data**: Google Sheets → Apps Script (JSONP) → halaman statis. Aman untuk GitHub Pages.
- **Animasi**: GSAP 3 (angka berjalan, batang tumbuh, transisi antar slide, FLIP saat
  peringkat berubah). Menghormati `prefers-reduced-motion`.
- **Kolom dideteksi otomatis**: kolom angka 1–N menjadi slide skala, kolom teks pilihan
  menjadi slide peringkat, dan slide pertama merangkum semuanya.

```
index.html
assets/css/styles.css
assets/js/config.js      ← satu-satunya file yang perlu diubah
assets/js/format.js
assets/js/api.js
assets/js/deck.js
apps-script/Code.gs      ← tempel ke Apps Script
apps-script/appsscript.json
```

---

## 1. Deploy backend (sekali saja, ±3 menit)

1. Buka spreadsheet Anda → **Extensions → Apps Script**.
2. Hapus isi `Code.gs`, tempel seluruh isi `apps-script/Code.gs`.
   Bila data bukan di tab pertama, isi `SHEET_NAME = "Form Responses 1"` di baris atas.
3. **Deploy → New deployment → Web app**
   - Description: `dashboard`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Klik **Deploy**, izinkan akses, lalu salin URL yang berakhiran **`/exec`**.
5. Jalankan fungsi **`installTriggers`** sekali (pilih di dropdown lalu ▶ Run).
   Ini memasang trigger `onFormSubmit` supaya data langsung ter-update saat ada
   kiriman baru. Bisa juga lewat menu **Dashboard → Pasang pembaruan otomatis**
   setelah halaman di-reload.

Uji cepat di browser:

```
https://script.google.com/macros/s/XXXX/exec?action=ping
```

Harus muncul JSON `{"ok":true,...}`.

## 2. Hubungkan halaman

Buka `assets/js/config.js`, isi:

```js
API_URL: "https://script.google.com/macros/s/XXXX/exec",
```

Simpan. Halaman langsung memakai data asli. Selama `API_URL` kosong, halaman
menampilkan **potret data asli** dari `assets/data/snapshot.json` (angka di layar
sama dengan isi sheet saat potret dibuat, tetapi belum ikut berubah). Potret itu
hanya untuk pratinjau — setelah `API_URL` diisi, file tersebut tidak dipakai lagi.

> Ingin memperbarui potret? Jalankan ulang skrip pembuatnya, atau cukup isi
> `API_URL` dan data akan selalu segar.

## 3. Hosting GitHub Pages

```bash
git add .
git commit -m "deck survei town hall + data sheets"
git branch -M main
git remote add origin https://github.com/USERNAME/REPO.git
git push -u origin main
```

Lalu **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.
Situs tersedia di `https://USERNAME.github.io/REPO/`.

File `.nojekyll` sudah disertakan agar folder `assets/` tidak diproses Jekyll.

---

## Cara data mengalir

| Langkah | Yang terjadi |
|---|---|
| Halaman dibuka | `GET /exec` → JSON lengkap (kolom, tipe, baris) |
| Tiap 2 detik | `GET /exec` → JSON lengkap; versinya dibandingkan di browser |
| Versi berubah | Angka & batang bertween ke nilai baru (tanpa permintaan tambahan) |
| Form terkirim | Baris baru masuk → versi berubah (trigger `onFormSubmit` mempercepat) |

Versi = nomor bump + jumlah baris + hash baris terakhir, sehingga perubahan isi
sel juga terdeteksi. Satu putaran polling hanya memakai **satu** permintaan ke
Apps Script; dulu dua (ping lalu data) sehingga latensinya dobel.

**Latensi normal: 2–4 detik** setelah kiriman masuk. Batas bawahnya adalah waktu
respons Apps Script itu sendiri (±2–3 detik per permintaan, termasuk satu
pengalihan `script.google.com` → `script.googleusercontent.com`), jadi
menurunkan `POLL_MS` di bawah ~2500 tidak banyak menolong. Kalau yang membuka
halaman banyak (mis. 20+ orang bersamaan), naikkan `POLL_MS` ke 5000–8000 agar
kuota Apps Script tidak cepat habis.

---

## Mengatur tampilan data

Semua pengaturan ada di `assets/js/config.js`.

**Label pendek** untuk daftar kiri dan ringkasan:

```js
LABELS: [
  { match: "kurikulum", label: "Kurikulum" },
  { match: "rps",       label: "RPS" },
  ...
]
```

`match` dicocokkan dengan teks pertanyaan (huruf kecil). Urutan penting: taruh yang
paling spesifik lebih dulu.

**Memaksa kolom tertentu** (bila ada kolom angka lain yang ikut terdeteksi):

```js
COLUMNS: {
  likert: ["Kurikulum", "RPS", "metode pembelajaran", "LMS", "literatur", "karier"],
  choice: "dikurangi"
}
```

**Lain-lain**: `TITLE`, `SUBTITLE`, `SUMMARY_HEADLINE`, `ROTATE_MS`, `LIKERT_MAX`.

**Ukuran tampilan.** Dek otomatis menyesuaikan diri: ukuran huruf mengikuti lebar
*dan* tinggi jendela, jadi isi slide selalu muat penuh tanpa perlu zoom browser.
Bila di layar/proyektor Anda hasilnya terasa terlalu besar atau terlalu kecil,
cukup ubah satu angka:

```js
DISPLAY_SCALE: 1      // 0.9 = lebih kecil, 1.1 = lebih besar
```

Teks skala ("Sangat tidak penting" … "Sangat penting") dipilih otomatis dari kata
kunci pada pertanyaan: *penting*, *setuju*, *puas*, *sering*.

**Cara angka Likert dihitung.** Tiap slide aspek menampilkan dua hal:

1. **Angka besar `8 dari 10`** — proporsi dosen yang memilih dua nilai tertinggi
   (5 atau 6), dibulatkan ke satuan per sepuluh. Dipakai karena paling mudah
   diucapkan di rapat.
2. **Rincian per nilai** — `27% dosen menilai 5 · 40 dari 151` dan
   `15% dosen menilai 6 · 22 dari 151`, supaya terlihat dari mana angka besar
   itu berasal.

Grafik batang di kanan menunjukkan sebaran seluruh jawaban 1–6 (jumlah orang
per nilai). Tidak ada skor rata-rata atau kategori yang ditampilkan.

Slide **Ringkasan** berupa kartu per aspek: batang kecil sebaran jawaban 1–6
(nilai terbanyak disorot), nama aspek, jumlah dosen pada nilai terbanyak, dan
keterangan "memilih angka N". Di bawahnya ada sorotan untuk pertanyaan pilihan.

**Tautan ke slide tertentu**: buka `index.html#4` untuk langsung ke slide ke-4
(berguna saat rapat atau saat mengirim tautan ke bagian tertentu).

---

## Jika ada masalah

| Gejala | Penyebab & solusi |
|---|---|
| Banner "Gagal memuat data" | `API_URL` salah / deployment belum "Anyone". Buka URL `/exec` di tab baru. |
| Semua slide kosong | Tidak ada kolom angka 1–N. Isi `COLUMNS.likert` manual. |
| Angka tidak berubah | Trigger belum terpasang → jalankan `installTriggers`, atau tunggu cache 20 detik. |
| Slide bertambah/berkurang | Jumlah kolom berubah di sheet; halaman membangun ulang otomatis. |
| Teks label aneh | Tambahkan entri `LABELS` yang cocok. |
| Terasa terlalu besar / kecil | Ubah `DISPLAY_SCALE` (0.9 atau 1.1) di `config.js`. |

## Catatan keamanan

Akses **Anyone** membuat URL `/exec` dapat dibaca siapa pun yang tahu alamatnya.
Cocok untuk survei internal yang tidak rahasia. Untuk data sensitif, batasi akses
web app (mis. "Anyone with Google account") dan sesuaikan pemuatan data.
