/**
 * BACKEND — Google Apps Script
 * ---------------------------------------------------------------------------
 * Menyajikan isi Google Sheet sebagai JSON (JSONP) untuk halaman statis
 * di GitHub Pages, tanpa masalah CORS.
 *
 * LANGKAH PASANG
 * 1. Buka Sheet → Extensions → Apps Script.
 * 2. Hapus isi Code.gs, tempel file ini. Isi SHEET_NAME bila perlu.
 * 3. Deploy → New deployment → Web app
 *      Execute as        : Me
 *      Who has access    : Anyone
 * 4. Salin URL yang berakhiran /exec ke API_URL di assets/js/config.js.
 * 5. Jalankan installTriggers() sekali agar data langsung ter-update
 *    setiap ada kiriman form baru (atau pakai menu "Dashboard").
 */

var SHEET_NAME = "";          // kosong = tab pertama
var CACHE_SECONDS = 20;       // cache singkat agar Sheet tidak dibaca tiap detik
var MAX_ROWS = 5000;          // batas jumlah baris yang dikirim

/* ------------------------------------------------------------------ ROUTER */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var callback = p.callback || "";
  var action = p.action || "data";

  var out;
  try {
    out = action === "ping" ? ping_() : data_(!!p.fresh);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return reply_(out, callback);
}

function doPost(e) {
  return doGet(e);
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

/* ------------------------------------------------------------------- DATA */

function ping_() {
  var cache = CacheService.getScriptCache();
  var sh = sheet_();
  var key = "p_" + hash_(sh.getName());

  var hit = cache.get(key);
  if (hit) {
    try { return JSON.parse(hit); } catch (ignore) { /* bangun ulang */ }
  }

  var out = {
    ok: true,
    v: version_(sh),
    sheet: sh.getName(),
    count: Math.max(0, sh.getLastRow() - 1),
    updatedAt: new Date().toISOString()
  };
  try { cache.put(key, JSON.stringify(out), 5); } catch (ignore) { /* abaikan */ }
  return out;
}

function data_(fresh) {
  var sh = sheet_();
  var v = version_(sh);
  var cache = CacheService.getScriptCache();
  var key = "d_" + hash_(sh.getName() + "|" + v);

  if (!fresh) {
    var hit = readChunks_(cache, key);
    if (hit) {
      try {
        var parsed = JSON.parse(hit);
        parsed.cached = true;
        return parsed;
      } catch (ignore) { /* cache rusak, bangun ulang */ }
    }
  }

  var payload = build_(sh, v);
  try {
    writeChunks_(cache, key, JSON.stringify(payload), CACHE_SECONDS);
  } catch (ignore) { /* cache penuh bukan masalah */ }
  return payload;
}

function build_(sh, v) {
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  var base = {
    ok: true,
    v: v,
    sheet: sh.getName(),
    columns: [],
    types: [],
    count: 0,
    rows: [],
    updatedAt: new Date().toISOString()
  };
  if (lastRow < 2 || lastCol < 1) return base;

  var height = Math.min(lastRow, MAX_ROWS + 1);
  var values = sh.getRange(1, 1, height, lastCol).getValues();

  var header = values.shift();
  base.columns = header.map(function (h, i) {
    var name = String(h || "").trim();
    return name || ("Kolom " + (i + 1));
  });
  base.types = base.columns.map(function (_, i) { return typeOf_(values, i); });

  var rows = values.filter(function (r) {
    return r.some(function (c) { return c !== "" && c !== null && c !== undefined; });
  });

  base.count = rows.length;
  base.rows = serialise_(rows);
  return base;
}

function serialise_(rows) {
  return rows.map(function (row) {
    return row.map(function (cell) {
      if (cell instanceof Date) return cell.toISOString();
      if (typeof cell === "number" && isFinite(cell)) return cell;
      if (cell === null || cell === undefined) return "";
      return String(cell);
    });
  });
}

function typeOf_(rows, i) {
  var num = 0, date = 0, text = 0;
  for (var r = 0; r < rows.length; r++) {
    var v = rows[r][i];
    if (v === "" || v === null || v === undefined) continue;
    if (v instanceof Date) date++;
    else if (typeof v === "number") num++;
    else text++;
  }
  if (date && !num && !text) return "datetime";
  if (num && !text) return "number";
  return "string";
}

/* ------------------------------------------------------------------ VERSI */

function version_(sh) {
  var bump = PropertiesService.getScriptProperties().getProperty("v") || "0";
  var lastRow = sh.getLastRow();
  var sig = "";
  if (lastRow >= 2) {
    var row = sh.getRange(lastRow, 1, 1, sh.getLastColumn()).getDisplayValues()[0].join("|");
    sig = hash_(row);
  }
  return bump + "-" + lastRow + "-" + sig;
}

function hash_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s));
  var out = "";
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out.slice(0, 12);
}

function bump_() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty("v", String(Number(props.getProperty("v") || 0) + 1));
}

/* ------------------------------------------------------------------ CACHE */

function writeChunks_(cache, key, value, seconds) {
  var size = 90000;
  var n = Math.ceil(value.length / size);
  if (n <= 1) {
    cache.put(key, value, seconds);
    return;
  }
  var map = {};
  for (var i = 0; i < n; i++) map[key + "_" + i] = value.substr(i * size, size);
  map[key + "_n"] = String(n);
  cache.putAll(map, seconds);
}

function readChunks_(cache, key) {
  var n = cache.get(key + "_n");
  if (n) {
    var keys = [];
    for (var i = 0; i < Number(n); i++) keys.push(key + "_" + i);
    var all = cache.getAll(keys);
    var out = "";
    for (var k = 0; k < keys.length; k++) {
      var part = all[keys[k]];
      if (part == null) return null;
      out += part;
    }
    return out;
  }
  return cache.get(key);
}

/* ------------------------------------------------------------------ SHEET */

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    var id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    if (!id) throw new Error("Script tidak terikat ke spreadsheet. Isi SPREADSHEET_ID.");
    ss = SpreadsheetApp.openById(id);
  }
  if (SHEET_NAME) {
    return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  }
  return ss.getSheets()[0];
}

/* --------------------------------------------------------------- TRIGGERS */

function installTriggers() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "onFormSubmit") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("onFormSubmit").forSpreadsheet(ss).onFormSubmit().create();
  bump_();
  try {
    SpreadsheetApp.getUi().alert("Siap. Setiap kiriman form baru akan langsung memperbarui dashboard.");
  } catch (ignore) { /* dipanggil dari editor, bukan menu */ }
}

function onFormSubmit() {
  bump_();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Dashboard")
    .addItem("Pasang pembaruan otomatis", "installTriggers")
    .addItem("Segarkan sekarang", "bump_")
    .addItem("Lihat URL web app", "showUrl_")
    .addToUi();
}

function showUrl_() {
  var url = ScriptApp.getService().getUrl() || "(belum di-deploy sebagai web app)";
  SpreadsheetApp.getUi().alert(url);
}
