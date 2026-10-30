/* ============================================================================
   KONFIGURASI DASHBOARD
   ----------------------------------------------------------------------------
   Satu-satunya file yang perlu Anda ubah setelah deploy Apps Script.
   ========================================================================== */

window.APP_CONFIG = {

  /* 1. URL Web App Apps Script — akhiran /exec
     Contoh:
     "https://script.google.com/macros/s/AKfycbx.../exec"
     Selama masih kosong, dashboard berjalan di MODE DEMO (data palsu).       */
  API_URL: "",

  /* 2. Nama sheet (tab) yang dibaca. Kosongkan = sheet pertama.              */
  SHEET_NAME: "",

  /* 3. Mode demo. `null` = otomatis: aktif bila API_URL kosong.              */
  MOCK: null,

  /* 4. Interval pengecekan data baru (milidetik). 8000–15000 disarankan.     */
  POLL_MS: 10000,

  /* 5. Paksa ambil ulang penuh tiap X ms, walau versi tidak berubah.         */
  FULL_REFRESH_MS: 300000,

  /* 6. Judul & teks.                                                          */
  TITLE: "Dashboard Respons Form",
  EYEBROW_LIVE: "Live",
  LEDE: "Setiap kiriman Google Form langsung tampil di sini — tanpa refresh, " +
        "tanpa ekspor manual, tanpa spreadsheet yang dibiarkan menumpuk.",
  FOOTER_NOTE: "Dibangun dengan Apps Script + GSAP.",

  /* 7. Format angka & tanggal.                                               */
  LOCALE: "id-ID",
  TIMEZONE: "Asia/Jakarta",
  CURRENCY: "",              // isi "IDR" bila ada kolom nominal
  NUMBER_DECIMALS: 0,

  /* 8. Pemetaan kolom MANUAL (opsional).
     Kosongkan agar dashboard menebak sendiri dari header & tipe data.
     Isi bila hasil tebakan kurang tepat, contoh:
     COLUMNS: { date: "Timestamp", name: "Nama Lengkap", rating: "Kepuasan",
                category: "Produk yang dipakai", region: "Kota Domisili" }     */
  COLUMNS: {},

  /* 9. Kata kunci untuk membantu penebakan kolom.                            */
  KEYWORDS: {
    date:     ["timestamp", "waktu", "tanggal", "date", "time", "submitted"],
    name:     ["nama", "name", "responden", "email", "username"],
    rating:   ["rating", "skor", "score", "kepuasan", "puas", "nilai", "nps", "bintang"],
    category: ["kategori", "category", "produk", "layanan", "divisi", "jenis", "minat", "sumber"],
    region:   ["kota", "city", "lokasi", "location", "region", "provinsi", "daerah", "domisili"]
  },

  /* 10. Palet kategori. Warna pertama = aksen utama.
      Urutan ini aman untuk buta warna (biru → oranye → hijau → ungu).        */
  PALETTE: ["#1f3dff", "#ff5b2e", "#1c7a55", "#7a4fd8", "#c99500", "#0f7f92"],

  /* 11. Jumlah baris pada kartu "Arus masuk terbaru".                         */
  RECENT_COUNT: 6,

  /* 12. Jumlah baris pada tabel data mentah.                                  */
  TABLE_ROWS: 60
};
