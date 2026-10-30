/* ============================================================================
   KONFIGURASI
   ----------------------------------------------------------------------------
   Satu-satunya file yang perlu Anda ubah setelah deploy Apps Script.
   ========================================================================== */

window.APP_CONFIG = {

  /* 1. URL Web App Apps Script — diakhiri /exec
     Contoh: "https://script.google.com/macros/s/AKfycb.../exec"
     Selama kosong, halaman berjalan dengan data contoh (mode demo).          */
  API_URL: "https://script.google.com/a/macros/pknstan.ac.id/s/AKfycbxonOCMGUzxeceS3D-U1tdig4ZEMrQlAeG0YRs1kCPzLl6iP7mE6Kb3m2oF__fYag3RIw/exec",

  /* 2. Nama tab sheet. Kosongkan = tab pertama.                              */
  SHEET_NAME: "Form Responses 1",

  /* 3. Mode demo. `null` = otomatis aktif bila API_URL kosong.               */
  MOCK: null,

  /* 4. Cek data baru tiap X ms. 2000 = hampir langsung, tapi lebih banyak
     permintaan ke Apps Script. Naikkan ke 5000–8000 bila pengunjung ramai.    */
  POLL_MS: 2000,

  /* 5. Paksa ambil ulang penuh tiap X ms walau versi tidak berubah.          */
  FULL_REFRESH_MS: 300000,

  /* 6. Lama tiap slide tampil sebelum pindah sendiri (ms).                   */
  ROTATE_MS: 12000,

  /* 7. Teks.                                                                 */
  TITLE: "Town Hall Meeting Dosen",
  SUBTITLE: "Realtime Data",
  SUMMARY_HEADLINE: "Hasil Survei Town Hall Meeting Dosen",
  SOURCE_LABEL: "GForm Survey Town Hall Meeting Dosen",

  /* 8. Format angka.                                                         */
  LOCALE: "id-ID",

  /* 9. Label pendek untuk daftar di kiri & ringkasan.
     `match` dicocokkan dengan teks pertanyaan (huruf kecil).
     Urutan penting: yang lebih spesifik ditaruh lebih dulu.                 */
  LABELS: [
    { match: "kurikulum",              label: "Kurikulum" },
    { match: "rps",                    label: "RPS" },
    { match: "metode pembelajaran",    label: "Metode pembelajaran" },
    { match: "learning management",    label: "LMS" },
    { match: "lms",                    label: "LMS" },
    { match: "literatur",              label: "Literatur" },
    { match: "jenjang karier",         label: "Jenjang karier" },
    { match: "dikurangi",              label: "Yang dikurangi" }
  ],

  /* 10. Pemetaan kolom manual (opsional).
     Kosongkan agar kolom ditebak otomatis dari isi data.
     Isi bila ada kolom angka lain yang ikut terbaca sebagai skala, contoh:
     COLUMNS: { likert: ["Kurikulum", "RPS"], choice: "dikurangi" }          */
  COLUMNS: { likert: [], choice: "" },

  /* 11. Skala maksimum yang dianggap skala Likert (1..N).                    */
  LIKERT_MAX: 10,

  /* 12. Skala tampilan. 1 = ukuran standar.
     Ukuran huruf sudah otomatis mengikuti lebar & tinggi layar (dek selalu
     mengisi jendela tanpa terpotong). Bila di layar/proyektor Anda dek terasa
     terlalu besar, turunkan mis. 0.9; bila terasa terlalu kecil, naikkan 1.1. */
  DISPLAY_SCALE: 1
};
