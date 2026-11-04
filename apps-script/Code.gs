/**
 * BACKEND — Google Apps Script
 * ---------------------------------------------------------------------------
 * Platform survei satu-pertanyaan-satu-putaran dengan mode host.
 *
 * LANGKAH PASANG
 * 1. Buka spreadsheet (boleh spreadsheet Google Form lama) → Extensions →
 *    Apps Script.
 * 2. Hapus isi Code.gs, tempel seluruh isi file ini.
 * 3. Deploy → New deployment → Web app
 *      Execute as     : Me
 *      Who has access : Anyone
 * 4. Salin URL yang berakhiran /exec ke API_URL di assets/js/config.js.
 * 5. Ganti PIN host: jalankan setHostPin() sekali, atau edit HOST_PIN di bawah.
 *
 * Jawaban disimpan otomatis di tab "Survei Town Hall". Tidak perlu trigger.
 */

var HOST_PIN = "1234";                 // ganti sebelum dipakai
var RESPONSES_SHEET = "Survei Town Hall";
var SESSION_KEY = "TH_SESSION_V1";
var CACHE_KEY = "TH_AGG_V1";
var CACHE_SECONDS = 2;

/* Definisi pertanyaan — harus sama dengan assets/js/questions.js */
var QUESTIONS = [
  {
    id: "q1", type: "likert", max: 6, short: "Kurikulum",
    text: "Kurikulum penting dikalibrasi secara berkala agar tetap relevan dengan perkembangan keuangan negara dan keilmuan."
  },
  {
    id: "q2", type: "likert", max: 6, short: "RPS",
    text: "RPS penting untuk diperbarui setiap semester agar materi kuliah tetap relevan."
  },
  {
    id: "q3", type: "likert", max: 6, short: "Metode pembelajaran",
    text: "Penerapan metode pembelajaran inovatif, seperti case-based learning dan project based learning penting untuk meningkatkan kualitas pembelajaran mahasiswa."
  },
  {
    id: "q4", type: "likert", max: 5, short: "LMS",
    text: "Learning Management System (LMS) penting untuk mendukung proses pembelajaran yang lebih efektif dan efisien."
  },
  {
    id: "q5", type: "likert", max: 6, short: "Literatur",
    text: "Penggunaan literatur dan referensi penting untuk mendukung kualitas materi serta proses pembelajaran."
  },
  {
    id: "q6", type: "choice", short: "Aktivitas yang dikurangi",
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

var HEADERS = ["Waktu", "RespondentID", "Kode", "Pertanyaan", "Jawaban", "Nilai"];

/* ------------------------------------------------------------------ ROUTER */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    out = route_(p);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return reply_(out, p.callback || "");
}

function doPost(e) {
  var p = (e && e.parameter) || {};
  if (e && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      Object.keys(body).forEach(function (k) { p[k] = body[k]; });
    } catch (ignore) { /* bukan JSON */ }
  }

  var out;
  try {
    out = route_(p);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return reply_(out, p.callback || "");
}

function route_(p) {
  var action = String(p.action || "state");

  if (action === "ping") return ping_();

  if (action === "state") return publicState_(p.rid);

  if (action === "hostState") {
    requirePin_(p.pin);
    return hostState_();
  }

  if (action === "answer") {
    return withLock_(function () { return answer_(p); });
  }

  if (action === "host") {
    requirePin_(p.pin);
    return withLock_(function () { return hostAction_(p); });
  }

  throw new Error("Aksi tidak dikenal: " + action);
}

function reply_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/* ----------------------------------------------------------------- SESSION */

function defaultSession_() {
  return {
    status: "idle",       // idle | open | revealed | done
    current: 0,
    revealed: false,
    round: 0,
    startedAt: null,
    updatedAt: null
  };
}

function getSession_() {
  var raw = PropertiesService.getScriptProperties().getProperty(SESSION_KEY);
  if (!raw) return defaultSession_();

  var s;
  try { s = JSON.parse(raw); } catch (e) { return defaultSession_(); }
  if (!s) return defaultSession_();

  return {
    status: s.status || "idle",
    current: Number(s.current || 0),
    revealed: !!s.revealed,
    round: Number(s.round || 0),
    startedAt: s.startedAt || null,
    updatedAt: s.updatedAt || null
  };
}

function setSession_(s) {
  s.updatedAt = new Date().toISOString();
  PropertiesService.getScriptProperties()
    .setProperty(SESSION_KEY, JSON.stringify(s));
  return s;
}

function sessionOut_(s) {
  return {
    status: s.status,
    current: s.current,
    revealed: !!s.revealed,
    round: s.round,
    total: QUESTIONS.length,
    startedAt: s.startedAt,
    updatedAt: s.updatedAt
  };
}

function requirePin_(pin) {
  var expected = PropertiesService.getScriptProperties().getProperty("HOST_PIN") || HOST_PIN;
  if (String(pin || "") !== String(expected)) {
    throw new Error("PIN salah");
  }
}

/* ------------------------------------------------------------------- SHEET */

/**
 * Diagnostik: memastikan script terikat ke spreadsheet yang benar.
 * Buka `<URL>/exec?action=ping` di browser untuk melihat nama, URL, dan
 * jumlah baris jawaban yang benar-benar dibaca script.
 */
function ping_() {
  var out = {
    ok: true,
    app: "survey-town-hall",
    version: 2,
    questions: QUESTIONS.length,
    sheet: RESPONSES_SHEET,
    now: new Date().toISOString()
  };

  try {
    var ss = spreadsheet_();
    out.spreadsheet = ss.getName();
    out.spreadsheetUrl = ss.getUrl();
    out.sheets = ss.getSheets().map(function (s) { return s.getName(); });

    var sh = ss.getSheetByName(RESPONSES_SHEET);
    out.responseSheetExists = !!sh;
    out.responseRows = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
  } catch (err) {
    out.spreadsheetError = String((err && err.message) || err);
  }

  return out;
}

function spreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;

  var id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("Script tidak terikat ke spreadsheet. Isi properti SPREADSHEET_ID.");
  return SpreadsheetApp.openById(id);
}

function responses_() {
  var ss = spreadsheet_();
  var sh = ss.getSheetByName(RESPONSES_SHEET);

  if (!sh) {
    sh = ss.insertSheet(RESPONSES_SHEET);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/* --------------------------------------------------------------- AGGREGATE */

function aggregate_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_KEY);
  if (hit) {
    try { return JSON.parse(hit); } catch (ignore) { /* bangun ulang */ }
  }

  var agg = readAggregate_();
  try { cache.put(CACHE_KEY, JSON.stringify(agg), CACHE_SECONDS); } catch (ignore) { /* penuh */ }
  return agg;
}

function readAggregate_() {
  var sh = responses_();
  var out = {
    respondents: 0,
    total: 0,
    counts: {},
    byRid: {}
  };

  var last = sh.getLastRow();
  if (last < 2) return out;

  var values = sh.getRange(2, 1, last - 1, 6).getValues();

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var rid = String(row[1] || "").trim();
    var qid = String(row[2] || "").trim();
    var value = Number(row[5]);

    if (!rid || !qid || !isFinite(value) || value <= 0) continue;

    out.total++;

    if (!out.counts[qid]) {
      out.counts[qid] = { n: 0, counts: {} };
    }
    out.counts[qid].n++;
    var key = String(value);
    out.counts[qid].counts[key] = (out.counts[qid].counts[key] || 0) + 1;

    if (!out.byRid[rid]) out.byRid[rid] = [];
    if (out.byRid[rid].indexOf(qid) === -1) out.byRid[rid].push(qid);
  }

  out.respondents = Object.keys(out.byRid).length;
  return out;
}

function resultFor_(agg, qid) {
  var c = agg.counts[qid] || { n: 0, counts: {} };
  return { n: c.n, counts: c.counts };
}

function rev_(s, agg) {
  return [
    s.status, s.current, s.revealed ? 1 : 0, s.round,
    agg.total, agg.respondents
  ].join(":");
}

function invalidateAggregate_() {
  try { CacheService.getScriptCache().remove(CACHE_KEY); } catch (ignore) { /* abaikan */ }
}

/**
 * Perbarui cache agregat secara inkremental setelah satu jawaban masuk.
 * Menghindari pembacaan ulang seluruh sheet pada tiap jawaban — penting saat
 * ±200 peserta menjawab hampir bersamaan.
 */
function bumpAggregate_(qid, value, rid) {
  var cache = CacheService.getScriptCache();
  var raw = cache.get(CACHE_KEY);
  if (!raw) return; // request berikutnya akan membangun ulang dari sheet

  var agg;
  try { agg = JSON.parse(raw); } catch (e) { cache.remove(CACHE_KEY); return; }
  if (!agg || !agg.counts || !agg.byRid) { cache.remove(CACHE_KEY); return; }

  // Sudah terhitung oleh pembangunan ulang yang terjadi setelah appendRow.
  if (agg.byRid[rid] && agg.byRid[rid].indexOf(qid) !== -1) return;

  agg.total = Number(agg.total || 0) + 1;

  if (!agg.counts[qid]) agg.counts[qid] = { n: 0, counts: {} };
  agg.counts[qid].n = Number(agg.counts[qid].n || 0) + 1;
  var key = String(value);
  agg.counts[qid].counts[key] = Number(agg.counts[qid].counts[key] || 0) + 1;

  if (!agg.byRid[rid]) agg.byRid[rid] = [];
  agg.byRid[rid].push(qid);
  agg.respondents = Object.keys(agg.byRid).length;

  cache.put(CACHE_KEY, JSON.stringify(agg), CACHE_SECONDS);

  // Setiap 25 jawaban, paksa bangun ulang dari sheet agar angka tidak melenceng.
  var bumpKey = CACHE_KEY + "_N";
  var n = Number(cache.get(bumpKey) || 0) + 1;
  if (n >= 25) {
    cache.remove(CACHE_KEY);
    cache.remove(bumpKey);
  } else {
    cache.put(bumpKey, String(n), 600);
  }
}

/* ------------------------------------------------------------ PUBLIC STATE */

function publicState_(rid) {
  var s = getSession_();
  var agg = aggregate_();
  var q = QUESTIONS[s.current] || QUESTIONS[0];
  var cleanRid = String(rid || "").slice(0, 64);
  var answered = s.status === "revealed" || s.status === "done";

  return {
    ok: true,
    rev: rev_(s, agg),
    session: sessionOut_(s),
    respondents: agg.respondents,
    answers: agg.total,
    answeredCurrent: q ? (agg.counts[q.id] || { n: 0 }).n : 0,
    myAnswered: cleanRid ? (agg.byRid[cleanRid] || []) : [],
    result: (answered && q) ? resultFor_(agg, q.id) : null
  };
}

function hostState_() {
  var s = getSession_();
  var agg = aggregate_();
  var q = QUESTIONS[s.current] || QUESTIONS[0];

  return {
    ok: true,
    rev: rev_(s, agg),
    session: sessionOut_(s),
    respondents: agg.respondents,
    answers: agg.total,
    answeredCurrent: q ? (agg.counts[q.id] || { n: 0 }).n : 0,
    results: agg.counts,
    total: QUESTIONS.length,
    updatedAt: new Date().toISOString()
  };
}

/* ------------------------------------------------------------------ ANSWER */

function answer_(p) {
  var s = getSession_();
  if (s.status !== "open") throw new Error("Sesi belum dibuka untuk jawaban");

  var q = QUESTIONS[s.current];
  if (!q) throw new Error("Pertanyaan tidak ditemukan");

  if (String(p.qid || "") !== q.id) {
    throw new Error("Pertanyaan sudah berganti — muat ulang halaman");
  }

  var rid = String(p.rid || "").trim();
  if (!rid || rid.length > 64) throw new Error("Identitas peserta tidak valid");

  var value = parseInt(p.value, 10);
  if (!isFinite(value) || value < 1) throw new Error("Jawaban tidak valid");

  if (q.type === "choice") {
    if (!q.options || value > q.options.length) throw new Error("Pilihan tidak valid");
  } else if (value > Number(q.max)) {
    throw new Error("Nilai di luar skala");
  }

  var sh = responses_();
  var last = sh.getLastRow();

  if (last >= 2) {
    var existing = sh.getRange(2, 2, last - 1, 2).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][0]).trim() === rid &&
          String(existing[i][1]).trim() === q.id) {
        return { ok: true, already: true };
      }
    }
  }

  var label = q.type === "choice" ? (q.options[value - 1] || String(value)) : String(value);
  sh.appendRow([new Date(), rid, q.id, q.text, label, value]);
  bumpAggregate_(q.id, value, rid);

  return { ok: true };
}

/* ------------------------------------------------------------- HOST ACTION */

function hostAction_(p) {
  var s = getSession_();
  var op = String(p.op || "");
  var cur = Number(s.current || 0);

  if (op === "start") {
    s.status = "open";
    s.current = 0;
    s.revealed = false;
    s.startedAt = new Date().toISOString();
    s.round = Number(s.round || 0) + 1;

  } else if (op === "reveal") {
    if (s.status === "open" || s.status === "revealed") {
      s.status = "revealed";
      s.revealed = true;
    }

  } else if (op === "hide") {
    if (s.status === "revealed") {
      s.status = "open";
      s.revealed = false;
    }

  } else if (op === "next") {
    if (s.status === "idle") throw new Error("Mulai sesi terlebih dahulu");
    if (cur < QUESTIONS.length - 1) {
      s.current = cur + 1;
      s.status = "open";
      s.revealed = false;
    } else {
      s.status = "done";
      s.revealed = true;
    }

  } else if (op === "goto" || op === "open") {
    var index = parseInt(p.index, 10);
    if (!isFinite(index) || index < 0 || index >= QUESTIONS.length) {
      throw new Error("Pertanyaan tidak valid");
    }
    s.current = index;
    if (op === "open") {
      s.status = "open";
      s.revealed = false;
    } else {
      s.status = "revealed";
      s.revealed = true;
    }

  } else if (op === "finish") {
    s.status = "done";
    s.revealed = true;

  } else if (op === "reset") {
    var round = Number(s.round || 0);
    s = defaultSession_();
    s.round = round;
    if (String(p.clear) === "1") {
      clearResponses_();
    }

  } else {
    throw new Error("Perintah host tidak dikenal");
  }

  setSession_(s);
  invalidateAggregate_();
  return hostState_();
}

function clearResponses_() {
  var sh = responses_();
  var last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 6).clearContent();
  }
  invalidateAggregate_();
}

/* ------------------------------------------------------------------- LOCK */

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    throw new Error("Server sedang sibuk — coba lagi sebentar");
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------- MENU */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Survey Town Hall")
    .addItem("Atur PIN host", "setHostPin")
    .addItem("Hapus semua jawaban", "confirmClearResponses")
    .addItem("Lihat URL web app", "showUrl_")
    .addToUi();
}

function setHostPin() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt(
    "PIN host",
    "Masukkan PIN baru (minimal 4 karakter):",
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var pin = String(res.getResponseText() || "").trim();
  if (pin.length < 4) {
    ui.alert("PIN minimal 4 karakter.");
    return;
  }

  PropertiesService.getScriptProperties().setProperty("HOST_PIN", pin);
  ui.alert("PIN host diperbarui.");
}

function confirmClearResponses() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert(
    "Hapus semua jawaban?",
    "Semua baris jawaban di tab \"" + RESPONSES_SHEET + "\" akan dihapus. " +
    "Tindakan ini tidak bisa dibatalkan.",
    ui.ButtonSet.YES_NO
  );
  if (res !== ui.Button.YES) return;

  clearResponses_();
  ui.alert("Semua jawaban sudah dihapus.");
}

function showUrl_() {
  var url = ScriptApp.getService().getUrl() || "(belum di-deploy sebagai web app)";
  SpreadsheetApp.getUi().alert(url);
}
