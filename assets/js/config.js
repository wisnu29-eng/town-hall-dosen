/* ============================================================================
   KONFIGURASI
   ----------------------------------------------------------------------------
   Satu-satunya file yang perlu Anda ubah setelah deploy Apps Script.
   ========================================================================== */

window.APP_CONFIG = {

  /* 1. URL Web App Apps Script — diakhiri /exec
        Contoh: "https://script.google.com/macros/s/AKfycb.../exec"
        Selama kosong, halaman berjalan dalam mode demo.                     */
  API_URL: "https://script.google.com/macros/s/AKfycbyxiB8FyeiuOe4L--i7d9HPX1qMG10JTzCumRrIcarN5pxQwBKBU92P-syhVYyN8qujJw/exec",

  /* 2. Nama tab sheet tempat jawaban disimpan. Dibuat otomatis bila belum ada. */
  RESPONSES_SHEET: "Survei Town Hall",

  /* 3. Mode demo.
        true  = selalu demo (jawaban disimulasikan, tanpa backend)
        false = selalu memakai API_URL (produksi)
        null  = otomatis: demo saat dibuka dari file:// atau localhost,
                live saat dipasang di GitHub Pages.
        `?demo=1` memaksa demo; `?demo=0` memaksa live.                      */
  DEMO: false,

  /* 4. Simulasi jawaban peserta di mode demo (agar grafik host terlihat hidup). */
  DEMO_AUTOFILL: true,

  /* 5. Interval polling (dasar; tiap permintaan diberi jeda acak ±20%).
        Dioptimalkan untuk ±200 peserta: peserta 10 detik, host 3 detik.
        Saat halaman peserta masih menunggu sesi dimulai, polling otomatis
        melambat ke 15 detik; setelah sesi selesai, 30 detik.               */
  POLL_MS_PARTICIPANT: 10000,
  POLL_MS_HOST: 3000,

  /* 6. Tautan yang ditampilkan sebagai QR di layar host. Kosong = otomatis
        mengarah ke index.html di folder yang sama.                          */
  JOIN_URL: "",

  /* 7. Teks.                                                                */
  TITLE: "Survey Town Hall Meeting Dosen",
  SUBTITLE: "Town Hall Meeting Dosen",
  ORG: "Politeknik Keuangan Negara STAN",

  /* 8. Format angka.                                                        */
  LOCALE: "id-ID"
};
