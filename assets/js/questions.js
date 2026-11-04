/* ============================================================================
   PERTANYAAN SURVEI
   ----------------------------------------------------------------------------
   Ubah teks pertanyaan di sini. Urutan array = urutan yang dibahas host.
   `max: 6` memakai skala 1–6; `max: 5` memakai skala 1–5.
   ========================================================================== */

window.SURVEY = (function () {
  "use strict";

  var scale6 = [
    { v: 1, label: "Sangat Tidak Penting" },
    { v: 2, label: "Tidak Penting" },
    { v: 3, label: "Kurang Penting" },
    { v: 4, label: "Cukup Penting" },
    { v: 5, label: "Penting" },
    { v: 6, label: "Sangat Penting" }
  ];

  var scale5 = [
    { v: 1, label: "Sangat Tidak Penting" },
    { v: 2, label: "Tidak Penting" },
    { v: 3, label: "Cukup Penting" },
    { v: 4, label: "Penting" },
    { v: 5, label: "Sangat Penting" }
  ];

  var questions = [
    {
      id: "q1",
      type: "likert",
      max: 6,
      short: "Kurikulum",
      text: "Kurikulum penting dikalibrasi secara berkala agar tetap relevan dengan perkembangan keuangan negara dan keilmuan."
    },
    {
      id: "q2",
      type: "likert",
      max: 6,
      short: "RPS",
      text: "RPS penting untuk diperbarui setiap semester agar materi kuliah tetap relevan."
    },
    {
      id: "q3",
      type: "likert",
      max: 6,
      short: "Metode pembelajaran",
      text: "Penerapan metode pembelajaran inovatif, seperti case-based learning dan project based learning penting untuk meningkatkan kualitas pembelajaran mahasiswa."
    },
    {
      id: "q4",
      type: "likert",
      max: 5,
      short: "LMS",
      text: "Learning Management System (LMS) penting untuk mendukung proses pembelajaran yang lebih efektif dan efisien."
    },
    {
      id: "q5",
      type: "likert",
      max: 6,
      short: "Literatur",
      text: "Penggunaan literatur dan referensi penting untuk mendukung kualitas materi serta proses pembelajaran."
    },
    {
      id: "q6",
      type: "choice",
      short: "Aktivitas yang dikurangi",
      text: "Jika Anda diminta memilih satu aktivitas untuk dikurangi/dihilangkan, mana yang dipilih?",
      options: [
        "Kewajiban publikasi di jurnal terindeks Scopus",
        "Penugasan tambahan di luar Tridarma perguruan tinggi",
        "Kewajiban melakukan penelitian",
        "Kewajiban menggunakan database dalam penugasan",
        "Pengayaan kompetensi melalui secondment/cross-function"
      ]
    }
  ];

  return {
    title: "Survey Town Hall Meeting Dosen",
    org: "Politeknik Keuangan Negara STAN",
    intro: "Survey ini merupakan survey anonymous.",
    instructions: [
      "Pertanyaan \u201cseberapa penting\u201d dengan skala 1\u20136.",
      "1 = Sangat Tidak Penting \u00b7 6 = Sangat Penting"
    ],
    scale6: scale6,
    scale5: scale5,
    questions: questions,
    scaleFor: function (max) {
      return Number(max) === 5 ? scale5 : scale6;
    },
    byId: function (id) {
      for (var i = 0; i < questions.length; i++) {
        if (questions[i].id === id) return questions[i];
      }
      return null;
    },
    indexOf: function (id) {
      for (var i = 0; i < questions.length; i++) {
        if (questions[i].id === id) return i;
      }
      return -1;
    }
  };
})();
