/* ============================================================================
   FORMAT & UTILITAS
   ========================================================================== */
(function (global) {
  "use strict";

  var CFG = global.APP_CONFIG || {};
  var LOCALE = CFG.LOCALE || "id-ID";

  var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
  var MONTHS_LONG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  var DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

  function isNum(v) {
    return typeof v === "number" ? isFinite(v) : (v !== "" && v !== null && v !== undefined && !isNaN(Number(v)));
  }

  function toNum(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var n = Number(String(v).replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    return isFinite(n) ? n : 0;
  }

  function num(v, decimals) {
    var n = toNum(v);
    var d = typeof decimals === "number" ? decimals : (CFG.NUMBER_DECIMALS || 0);
    try {
      return new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: d,
        maximumFractionDigits: d
      }).format(n);
    } catch (e) {
      return String(Math.round(n));
    }
  }

  function compact(v) {
    var n = toNum(v);
    var abs = Math.abs(n);
    if (abs >= 1e9) return trim(n / 1e9) + "B";
    if (abs >= 1e6) return trim(n / 1e6) + "jt";
    if (abs >= 1e4) return trim(n / 1e3) + "rb";
    return num(n);
  }

  function trim(n) {
    var r = Math.round(n * 10) / 10;
    return String(r).replace(".0", "").replace(".", ",");
  }

  function pct(part, total, decimals) {
    if (!total) return "0%";
    var p = (part / total) * 100;
    var d = typeof decimals === "number" ? decimals : (p < 10 ? 1 : 0);
    return trim(Number(p.toFixed(d))) + "%";
  }

  function toDate(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === "number") {
      // epoch seconds vs millis
      var ms = v < 1e12 ? v * 1000 : v;
      var d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof v === "string" && v.trim()) {
      var s = v.trim();
      var parsed = new Date(s);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return null;
  }

  function dayKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function startOfDay(d) {
    var x = new Date(d.getTime());
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  function daysBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  }

  function dateShort(d) {
    return d.getDate() + " " + MONTHS_SHORT[d.getMonth()];
  }

  function dateLong(d) {
    return DAYS[d.getDay()] + ", " + d.getDate() + " " + MONTHS_LONG[d.getMonth()] + " " + d.getFullYear();
  }

  function clock(d) {
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function relTime(d) {
    if (!d) return "—";
    var diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 5) return "baru saja";
    if (diff < 60) return diff + " dtk lalu";
    if (diff < 3600) return Math.floor(diff / 60) + " mnt lalu";
    if (diff < 86400) return Math.floor(diff / 3600) + " jam lalu";
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + " hari lalu";
    return dateShort(d);
  }

  function niceMax(v) {
    if (!isFinite(v) || v <= 0) return 1;
    var exp = Math.floor(Math.log10(v));
    var f = v / Math.pow(10, exp);
    var steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) {
      if (f <= steps[i] + 1e-9) return steps[i] * Math.pow(10, exp);
    }
    return 10 * Math.pow(10, exp);
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function sum(arr, fn) {
    var t = 0;
    for (var i = 0; i < arr.length; i++) t += fn ? fn(arr[i], i) : arr[i];
    return t;
  }

  global.FMT = {
    isNum: isNum, toNum: toNum, num: num, compact: compact, pct: pct,
    toDate: toDate, dayKey: dayKey, startOfDay: startOfDay, addDays: addDays,
    daysBetween: daysBetween, dateShort: dateShort, dateLong: dateLong,
    clock: clock, relTime: relTime, niceMax: niceMax, esc: esc, clamp: clamp,
    sum: sum, pad: pad, MONTHS_SHORT: MONTHS_SHORT
  };
})(window);
