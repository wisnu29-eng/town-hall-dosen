/* ============================================================================
   DATA LAYER
   - Membaca JSON dari Apps Script Web App lewat JSONP (bebas CORS)
   - Polling ringan: cek "versi" dulu, ambil data penuh hanya bila berubah
   - Mode demo: data sintetis yang terus bertambah agar animasi bisa dicoba
   ========================================================================== */
(function (global) {
  "use strict";

  var CFG = global.APP_CONFIG || {};
  var ENDPOINT = (CFG.API_URL || "").trim();
  var MOCK = CFG.MOCK === null || CFG.MOCK === undefined ? !ENDPOINT : !!CFG.MOCK;
  var POLL_MS = CFG.POLL_MS || 10000;
  var FULL_REFRESH_MS = CFG.FULL_REFRESH_MS || 300000;

  var state = {
    version: null,
    lastFull: 0,
    timer: null,
    inflight: false,
    handlers: { data: null, status: null, error: null }
  };

  /* ---------------------------------------------------------------- JSONP -- */
  var seq = 0;
  function jsonp(url, params, timeout) {
    return new Promise(function (resolve, reject) {
      var name = "__dsb_cb_" + Date.now().toString(36) + "_" + (++seq);
      var script = document.createElement("script");
      var done = false;
      var qs = [];
      Object.keys(params || {}).forEach(function (k) {
        qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
      });
      qs.push("callback=" + name);

      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("timeout"));
      }, timeout || 15000);

      function cleanup() {
        clearTimeout(timer);
        try { delete global[name]; } catch (e) { global[name] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      global[name] = function (payload) {
        if (done) return;
        done = true;
        cleanup();
        resolve(payload);
      };

      script.onerror = function () {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("network"));
      };

      script.src = url + (url.indexOf("?") === -1 ? "?" : "&") + qs.join("&");
      document.head.appendChild(script);
    });
  }

  /* ------------------------------------------------------------------ MOCK -- */
  var MOCK_DATA = (function () {
    var NAMES = ["Budi Santoso", "Sari Wulandari", "Rizky Pratama", "Dewi Lestari", "Agus Setiawan",
      "Putri Anggraini", "Hendra Wijaya", "Maya Kusuma", "Fajar Nugroho", "Intan Permata",
      "Yoga Saputra", "Nadia Rahmawati", "Bayu Firmansyah", "Citra Maharani", "Dimas Anggara",
      "Rani Oktaviani", "Eko Purnomo", "Lia Handayani", "Taufik Hidayat", "Sinta Amelia",
      "Adi Kurniawan", "Wulan Sari", "Reza Maulana", "Nisa Aulia"];
    var CITIES = ["Jakarta", "Bandung", "Surabaya", "Yogyakarta", "Denpasar", "Medan", "Semarang", "Makassar"];
    var PRODUCTS = ["Paket Dasar", "Paket Pro", "Paket Bisnis", "Add-on Analitik", "Konsultasi"];
    var NOTES = ["Sangat membantu, terima kasih.", "Mudah dipakai.", "Perlu tutorial tambahan.",
      "Harga masih bisa dipertimbangkan.", "Fitur laporan excel ditunggu.", "", "", "", ""];

    var rnd = mulberry32(20261030);
    var rows = [];
    var version = 1;
    var counter = 0;

    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
    function weightedRating() {
      var r = rnd();
      if (r < 0.06) return 1;
      if (r < 0.16) return 2;
      if (r < 0.42) return 3;
      if (r < 0.78) return 4;
      return 5;
    }

    function makeRow(date) {
      var rating = weightedRating();
      return [
        date.toISOString(),
        pick(NAMES) + (rnd() > 0.72 ? " " + String.fromCharCode(65 + Math.floor(rnd() * 26)) + "." : ""),
        pick(CITIES),
        pick(PRODUCTS),
        rating,
        Math.max(1, Math.min(5, rating + (rnd() > 0.7 ? (rnd() > 0.5 ? 1 : -1) : 0))),
        pick(NOTES)
      ];
    }

    function build() {
      var now = new Date();
      var DAYS = 46;
      for (var d = DAYS; d >= 0; d--) {
        var date = new Date(now.getTime() - d * 86400000);
        var dow = date.getDay();
        var weekend = (dow === 0 || dow === 6);
        var trend = 2.1 + (DAYS - d) * 0.055;
        var wave = Math.sin((DAYS - d) / 7 * Math.PI * 2) * 0.9;
        var noise = (rnd() - 0.5) * 1.7;
        var count = Math.max(0, Math.round(trend + wave + noise + (weekend ? -1.1 : 0.6)));
        for (var i = 0; i < count; i++) {
          var t = new Date(date.getTime());
          t.setHours(7 + Math.floor(rnd() * 14), Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
          if (t > now) t = new Date(now.getTime() - Math.floor(rnd() * 3 * 3600000));
          rows.push(makeRow(t));
        }
      }
      rows.sort(function (a, b) { return new Date(a[0]) - new Date(b[0]); });
    }
    build();

    return {
      payload: function (withRows) {
        var p = {
          ok: true,
          v: String(version),
          updatedAt: new Date().toISOString(),
          sheet: "Form Responses 1 (demo)",
          columns: ["Timestamp", "Nama", "Kota", "Produk", "Rating", "Kepuasan", "Saran"],
          types: ["datetime", "string", "string", "string", "number", "number", "string"],
          count: rows.length,
          demo: true
        };
        if (withRows) p.rows = rows.slice();
        return p;
      },
      ping: function () {
        return { ok: true, v: String(version), updatedAt: new Date().toISOString(), count: rows.length };
      },
      tick: function () {
        var d = new Date();
        rows.push(makeRow(d));
        version++;
        counter++;
        return counter;
      }
    };
  })();

  /* ------------------------------------------------------------- REQUESTS -- */
  function fetchPing() {
    if (MOCK) return Promise.resolve(MOCK_DATA.ping());
    return jsonp(ENDPOINT, { action: "ping", _t: Date.now() }, 12000);
  }

  function fetchData(fresh) {
    if (MOCK) return Promise.resolve(MOCK_DATA.payload(true));
    return jsonp(ENDPOINT, { _t: Date.now(), fresh: fresh ? "1" : "0" }, 20000);
  }

  /* --------------------------------------------------------------- PUBLIC -- */
  var API = {
    isMock: MOCK,
    endpoint: ENDPOINT,

    /** Muat penuh. */
    load: function (opts) {
      opts = opts || {};
      var force = !!opts.force;
      return fetchData(force).then(function (payload) {
        if (!payload || payload.ok === false) {
          throw new Error((payload && payload.error) || "Respons tidak valid");
        }
        state.version = String(payload.v || "");
        state.lastFull = Date.now();
        return payload;
      });
    },

    /** Cek versi; panggil onData hanya bila berubah. */
    check: function () {
      if (state.inflight) return Promise.resolve(null);
      state.inflight = true;
      var stale = Date.now() - state.lastFull > FULL_REFRESH_MS;

      return fetchPing()
        .then(function (ping) {
          if (!ping || ping.ok === false) throw new Error("ping gagal");
          var changed = String(ping.v || "") !== state.version;
          if (!changed && !stale) return null;
          return fetchData(false).then(function (payload) {
            if (!payload || payload.ok === false) throw new Error("data gagal");
            state.version = String(payload.v || "");
            state.lastFull = Date.now();
            return payload;
          });
        })
        .then(function (payload) {
          state.inflight = false;
          if (payload && state.handlers.data) state.handlers.data(payload);
          if (state.handlers.status) state.handlers.status("ok", { mock: MOCK, at: new Date() });
          return payload || null;
        })
        .catch(function (err) {
          state.inflight = false;
          if (state.handlers.status) state.handlers.status("error", null, err);
          throw err;
        });
    },

    start: function (handlers) {
      state.handlers = handlers || {};
      var self = this;

      function loop() {
        clearTimeout(state.timer);
        state.timer = setTimeout(function () {
          if (MOCK) {
            MOCK_DATA.tick();
            if (state.handlers.data) state.handlers.data(MOCK_DATA.payload(true));
            if (state.handlers.status) state.handlers.status("ok", { mock: true, at: new Date() });
          } else {
            self.check().catch(function () { /* status sudah dilaporkan */ });
          }
          loop();
        }, POLL_MS);
      }

      if (state.handlers.status) state.handlers.status(MOCK ? "mock" : "connecting", { mock: MOCK, at: new Date() });
      loop();
    },

    stop: function () {
      clearTimeout(state.timer);
      state.timer = null;
    },

    /** Paksa ambil ulang penuh sekarang. */
    refresh: function () {
      return this.load({ force: true });
    }
  };

  global.DATA_API = API;
})(window);
