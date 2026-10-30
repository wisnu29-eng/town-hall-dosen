/**
 * ============================================================================
 *  LIVE SHEET DASHBOARD — API untuk GitHub Pages
 * ----------------------------------------------------------------------------
 *  Membaca Google Sheet (hasil Google Form) dan menyajikannya sebagai JSON
 *  lewat Web App. Mendukung JSONP agar bisa dipanggil dari GitHub Pages
 *  tanpa masalah CORS.
 *
 *  CARA PASANG
 *  1. Buka spreadsheet respons form Anda.
 *  2. Extensions > Apps Script.
 *  3. Hapus isi Code.gs, tempel file ini, Save.
 *  4. (Opsional) Isi CONFIG.SHEET_NAME bila bukan sheet pertama.
 *  5. Deploy > New deployment > Web app
 *       - Description : dashboard
 *       - Execute as  : Me
 *       - Who has access : Anyone
 *     Klik Deploy, lalu salin URL yang berakhiran /exec.
 *  6. Tempel URL itu ke assets/js/config.js -> API_URL.
 *  7. Jalankan `installTriggers` sekali (via menu Dashboard di spreadsheet
 *     atau tombol Run di editor) agar data baru langsung terdeteksi.
 * ============================================================================
 */

// ---------------------------------------------------------------- KONFIGURASI
var CONFIG = {
  // Kosongkan bila script ini terikat (container-bound) pada spreadsheet.
  SPREADSHEET_ID: '',

  // Nama tab sheet. Kosongkan = sheet pertama.
  SHEET_NAME: '',

  // Zona waktu untuk interpretasi tanggal.
  TIMEZONE: 'Asia/Jakarta',

  // Lama cache data (detik). 15–30 detik sudah terasa "instan".
  CACHE_SECONDS: 20,

  // Lama cache "sidik jari" sheet (detik) — dipakai endpoint ping.
  SIG_SECONDS: 8,

  // Batas jumlah baris yang dibaca (jaga kuota & ukuran respons).
  MAX_ROWS: 20000,

  // Ukuran potongan cache (limit Apps Script 100KB per key).
  MAX_CHUNK: 90000,

  // Nama properti penyimpan versi.
  PROP_VERSION: 'DASHBOARD_VERSION'
};

// ------------------------------------------------------------------- ROUTER
function doGet(e) {
  var params = (e && e.parameter) || {};
  var callback = params.callback || '';
  var payload;

  try {
    if (params.action === 'ping') {
      payload = ping_();
    } else {
      payload = data_(params.fresh === '1');
    }
    payload.ok = true;
  } catch (err) {
    payload = { ok: false, error: String((err && err.message) || err) };
  }

  var body = JSON.stringify(payload);

  if (callback && /^[A-Za-z_$][\w$]*(\.[\w$]*)*$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + '(' + body + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

// POST boleh dipakai untuk webhook / alat lain.
function doPost(e) {
  return doGet(e);
}

// --------------------------------------------------------------------- PING
/**
 * Balasan super ringan: hanya versi data.
 * Klien memanggil ini tiap ~10 detik, lalu mengambil data penuh
 * hanya bila versinya berubah.
 */
function ping_() {
  var sheet = getSheet_();
  var sig = signature_(sheet);
  return {
    ok: true,
    v: version_() + ':' + sig,
    sheet: sheet.getName(),
    count: Math.max(0, sheet.getLastRow() - 1),
    updatedAt: new Date().toISOString()
  };
}

// --------------------------------------------------------------------- DATA
function data_(fresh) {
  var sheet = getSheet_();
  var sig = signature_(sheet);
  var version = version_() + ':' + sig;
  var cache = CacheService.getScriptCache();
  var key = 'dsb_' + hash_(sheet.getName() + '|' + version);

  if (!fresh) {
    var metaRaw = cache.get(key + '_m');
    if (metaRaw) {
      try {
        var meta = JSON.parse(metaRaw);
        var joined = readChunks_(cache, key, meta.n);
        if (joined) {
          var cached = JSON.parse(joined);
          cached.cached = true;
          return cached;
        }
      } catch (ignore) { /* cache rusak -> bangun ulang */ }
    }
  }

  var payload = build_(sheet);
  payload.v = version;
  writeChunks_(cache, key, JSON.stringify(payload));
  return payload;
}

// -------------------------------------------------------------------- BUILD
function build_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastRow < 1 || lastCol < 1) {
    return {
      ok: true, v: '0', updatedAt: new Date().toISOString(),
      sheet: sheet.getName(), columns: [], types: [], count: 0, rows: []
    };
  }

  var rowLimit = Math.min(lastRow, CONFIG.MAX_ROWS);
  var values = sheet.getRange(1, 1, rowLimit, lastCol).getValues();

  var headers = (values.shift() || []).map(function (h, i) {
    var name = String(h == null ? '' : h).trim();
    return name || ('Kolom ' + (i + 1));
  });

  var rows = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var out = new Array(lastCol);
    var filled = false;
    for (var c = 0; c < lastCol; c++) {
      var v = row[c];
      if (v instanceof Date) {
        out[c] = v.toISOString();
        filled = true;
      } else if (typeof v === 'number') {
        out[c] = isFinite(v) ? Math.round(v * 10000) / 10000 : null;
        filled = true;
      } else if (v === null || v === undefined || v === '') {
        out[c] = '';
      } else {
        out[c] = String(v).slice(0, 800);
        filled = true;
      }
    }
    if (filled) rows.push(out);
  }

  return {
    ok: true,
    v: '0',
    updatedAt: new Date().toISOString(),
    sheet: sheet.getName(),
    columns: headers,
    types: inferTypes_(rows, headers.length),
    count: rows.length,
    rows: rows
  };
}

/** Tebak tipe tiap kolom dari 150 baris pertama. */
function inferTypes_(rows, width) {
  var sample = Math.min(rows.length, 150);
  var types = [];

  for (var c = 0; c < width; c++) {
    var dates = 0, numbers = 0, filled = 0;
    for (var r = 0; r < sample; r++) {
      var v = rows[r][c];
      if (v === '' || v === null) continue;
      filled++;
      if (typeof v === 'number') numbers++;
      else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) dates++;
    }
    if (!filled) { types.push('string'); continue; }
    if (dates / filled > 0.7) types.push('datetime');
    else if (numbers / filled > 0.7) types.push('number');
    else types.push('string');
  }
  return types;
}

// ------------------------------------------------------------- CACHE HELPERS
function readChunks_(cache, key, count) {
  if (!count) return '';
  var keys = [];
  for (var i = 0; i < count; i++) keys.push(key + '_' + i);
  var found = cache.getAll(keys);
  var parts = [];
  for (var j = 0; j < count; j++) {
    var part = found[key + '_' + j];
    if (part == null) return '';
    parts.push(part);
  }
  return parts.join('');
}

function writeChunks_(cache, key, json) {
  try {
    var chunks = [];
    for (var i = 0; i < json.length; i += CONFIG.MAX_CHUNK) {
      chunks.push(json.slice(i, i + CONFIG.MAX_CHUNK));
    }
    // CacheService membatasi jumlah key per pemanggilan; kirim per 50.
    for (var s = 0; s < chunks.length; s += 50) {
      var batch = {};
      for (var k = s; k < Math.min(s + 50, chunks.length); k++) {
        batch[key + '_' + k] = chunks[k];
      }
      cache.putAll(batch, CONFIG.CACHE_SECONDS);
    }
    cache.put(key + '_m', JSON.stringify({ n: chunks.length, at: Date.now() }), CONFIG.CACHE_SECONDS);
  } catch (err) {
    // Kalau gagal menyimpan, tidak masalah: data tetap dikirim ke klien.
    Logger.log('cache write gagal: ' + err);
  }
}

function hash_(str) {
  var h = 5381;
  for (var i = 0; i < str.length; i++) {
    h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// ------------------------------------------------------------ SHEET & VERSI
function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  var active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { active = null; }
  if (active) return active;

  var stored = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (stored) return SpreadsheetApp.openById(stored);

  throw new Error('Spreadsheet tidak ditemukan. Isi CONFIG.SPREADSHEET_ID.');
}

function getSheet_() {
  var ss = getSpreadsheet_();
  if (CONFIG.SHEET_NAME) {
    var named = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!named) throw new Error('Sheet "' + CONFIG.SHEET_NAME + '" tidak ada.');
    return named;
  }
  return ss.getSheets()[0];
}

/**
 * Sidik jari murah: jumlah baris + hash baris terakhir.
 * Berubah setiap ada respons baru, tanpa membaca seluruh sheet.
 */
function signature_(sheet) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('dsb_sig');
  if (cached) return cached;

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var tail = '';
  if (lastRow >= 1 && lastCol >= 1) {
    tail = sheet.getRange(lastRow, 1, 1, lastCol).getDisplayValues()[0].join('|');
  }
  var sig = lastRow + '.' + hash_(tail);
  cache.put('dsb_sig', sig, CONFIG.SIG_SECONDS);
  return sig;
}

function version_() {
  var props = PropertiesService.getScriptProperties();
  var v = props.getProperty(CONFIG.PROP_VERSION);
  if (!v) {
    v = String(Date.now());
    props.setProperty(CONFIG.PROP_VERSION, v);
  }
  return v;
}

/** Naikkan versi + buang cache. Dipanggil saat ada respons baru. */
function bump_() {
  PropertiesService.getScriptProperties().setProperty(CONFIG.PROP_VERSION, String(Date.now()));
  CacheService.getScriptCache().remove('dsb_sig');
}

// ------------------------------------------------------------------ TRIGGER
/**
 * Pasang trigger form-submit pada spreadsheet ini.
 * Jalankan SEKALI dari editor Apps Script (pilih fungsi ini > Run).
 */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onFormSubmit') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('onFormSubmit')
    .forSpreadsheet(getSpreadsheet_())
    .onFormSubmit()
    .create();

  bump_();
  Logger.log('Trigger onFormSubmit terpasang.');
  return 'Trigger terpasang';
}

function onFormSubmit(e) {
  bump_();
}

/** Bisa dipanggil manual untuk memaksa cache dibersihkan. */
function clearCache() {
  bump_();
  Additional_clearDataCache_();
  Logger.log('Cache dibersihkan.');
  return 'Cache dibersihkan';
}

function Additional_clearDataCache_() {
  // Versi berubah -> key cache lama otomatis tidak terpakai lagi.
  CacheService.getScriptCache().remove('dsb_sig');
}

// --------------------------------------------------------------------- MENU
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('Dashboard')
      .addItem('Salin URL API', 'showApiUrl')
      .addItem('Pasang trigger form submit', 'installTriggers')
      .addItem('Kosongkan cache', 'clearCache')
      .addItem('Cek koneksi API', 'showApiStatus')
      .addToUi();
  } catch (e) {
    // Menu hanya tersedia untuk spreadsheet terikat.
  }
}

function showApiUrl() {
  var url = ScriptApp.getService().getUrl() || '(belum dideploy)';
  SpreadsheetApp.getUi().alert(
    'Tempel URL ini ke assets/js/config.js -> API_URL:\n\n' + url +
    '\n\nPastikan deployment: Execute as "Me", Who has access "Anyone".'
  );
}

function showApiStatus() {
  try {
    var sheet = getSheet_();
    var p = ping_();
    SpreadsheetApp.getUi().alert(
      'Sheet : ' + sheet.getName() +
      '\nBaris : ' + (sheet.getLastRow() - 1) +
      '\nVersi : ' + p.v
    );
  } catch (err) {
    SpreadsheetApp.getUi().alert('Error: ' + err.message);
  }
}

/** Untuk uji cepat dari editor: tampilkan ringkasan payload di log. */
function testPayload() {
  var p = data_(true);
  Logger.log('Sheet : ' + p.sheet);
  Logger.log('Kolom : ' + p.columns.join(', '));
  Logger.log('Tipe  : ' + p.types.join(', '));
  Logger.log('Baris : ' + p.count);
  Logger.log('Sampel: ' + JSON.stringify(p.rows.slice(0, 2)));
  return 'OK';
}
