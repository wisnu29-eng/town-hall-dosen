/* ============================================================================
   DATA LAYER
   - Membaca JSON dari Apps Script Web App lewat JSONP (bebas CORS)
   - Polling ringan: cek "versi" dulu, ambil data penuh hanya bila berubah
   - Mode demo: data contoh dengan bentuk yang sama seperti sheet asli
   ========================================================================== */
(function (global) {
  "use strict";

  var CFG = global.APP_CONFIG || {};
  var ENDPOINT = (CFG.API_URL || "").trim();
  var MOCK = CFG.MOCK === null || CFG.MOCK === undefined ? !ENDPOINT : !!CFG.MOCK;
  var POLL_MS = CFG.POLL_MS || 10000;
  var FULL_REFRESH_MS = CFG.FULL_REFRESH_MS || 300000;
  var SNAPSHOT_URL = CFG.SNAPSHOT_URL || "assets/data/snapshot.json";

  /* Pratinjau: bila API_URL kosong, pakai potret data asli (bukan data palsu). */
  var SNAPSHOT = null;
  var snapshotTried = false;

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
    var QUESTIONS = [
      "Seberapa penting kurikulum di-update secara berkala agar tetap relevan dengan perkembangan ilmu dan isu keuangan negara saat ini?",
      "Seberapa penting RPS diperbarui setiap semester supaya materi kuliah tetap relevan dan tidak hanya copy-paste dari semester sebelumnya?",
      "Seberapa penting penerapan metode pembelajaran inovatif, seperti case-based learning dan project-based learning, dalam meningkatkan kualitas pembelajaran mahasiswa?",
      "Seberapa penting penggunaan Learning Management System (LMS) untuk mendukung proses pembelajaran yang lebih efektif dan efisien?",
      "Seberapa penting penggunaan literatur dan referensi terbaru dalam mendukung kualitas materi serta proses pembelajaran?",
      "Seberapa penting kesempatan naik jenjang karier atau jabatan akademik dalam mendukung pengembangan diri dosen?"
    ];
    var CHOICE_Q = "Jika dari beberapa aktivitas atau kewajiban berikut ada satu yang boleh dikurangi atau dihilangkan, akan pilih yang mana?";
    var CHOICES = [
      { label: "Penugasan tambahan di luar tugas utama", w: 56 },
      { label: "Kewajiban publikasi di jurnal terindeks Scopus", w: 26 },
      { label: "Kolaborasi lintas fungsi (cross-function)", w: 30 },
      { label: "Kewajiban melakukan penelitian", w: 20 },
      { label: "Kewajiban menggunakan database dalam penugasan", w: 19 }
    ];
    /* Sebaran jawaban contoh, meniru hasil survei asli. */
    var DISTS = [
      [2, 2, 8, 23, 46, 70],
      [3, 3, 5, 32, 51, 57],
      [0, 2, 12, 17, 49, 71],
      [0, 7, 11, 29, 49, 55],
      [1, 3, 8, 22, 52, 65],
      [1, 4, 9, 43, 61, 33]
    ];

    var COLUMNS = ["Timestamp"].concat(QUESTIONS).concat([CHOICE_Q]);
    var TYPES = ["datetime"].concat(QUESTIONS.map(function () { return "number"; })).concat(["string"]);

    var rnd = mulberry32(20261030);
    var rows = [];
    var version = 1;

    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    function sampleDist(dist) {
      var total = 0, i;
      for (i = 0; i < dist.length; i++) total += dist[i];
      var r = rnd() * total;
      for (i = 0; i < dist.length; i++) {
        r -= dist[i];
        if (r <= 0) return i + 1;
      }
      return dist.length;
    }

    function sampleChoice() {
      var total = 0, i;
      for (i = 0; i < CHOICES.length; i++) total += CHOICES[i].w;
      var r = rnd() * total;
      for (i = 0; i < CHOICES.length; i++) {
        r -= CHOICES[i].w;
        if (r <= 0) return CHOICES[i].label;
      }
      return CHOICES[0].label;
    }

    function makeRow(date) {
      return [date.toISOString()]
        .concat(DISTS.map(sampleDist))
        .concat([sampleChoice()]);
    }

    (function build() {
      var now = Date.now();
      for (var i = 0; i < 151; i++) {
        rows.push(makeRow(new Date(now - (151 - i) * 97000)));
      }
    })();

    return {
      payload: function (withRows) {
        var p = {
          ok: true,
          v: String(version),
          updatedAt: new Date().toISOString(),
          sheet: "Form Responses 1 (contoh)",
          columns: COLUMNS,
          types: TYPES,
          count: rows.length,
          demo: true
        };
        if (withRows) p.rows = rows.map(function (r) { return r.slice(); });
        return p;
      },
      ping: function () {
        return { ok: true, v: String(version), updatedAt: new Date().toISOString(), count: rows.length };
      },
      tick: function () {
        rows.push(makeRow(new Date()));
        version++;
      }
    };
  })();

  /* ------------------------------------------------------------- REQUESTS -- */
  function loadSnapshot() {
    if (SNAPSHOT) return Promise.resolve(SNAPSHOT);
    if (snapshotTried) return Promise.resolve(MOCK_DATA.payload(true));
    snapshotTried = true;

    return fetch(SNAPSHOT_URL, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("snapshot " + r.status);
        return r.json();
      })
      .then(function (json) {
        if (!json || !json.rows || !json.rows.length) throw new Error("snapshot kosong");
        json.demo = true;
        SNAPSHOT = json;
        API.isSnapshot = true;
        return json;
      })
      .catch(function () {
        return MOCK_DATA.payload(true);
      });
  }

  function fetchData(fresh) {
    if (MOCK) return Promise.resolve(MOCK_DATA.payload(true));
    return jsonp(ENDPOINT, { _t: Date.now(), fresh: fresh ? "1" : "0" }, 20000);
  }

  /* --------------------------------------------------------------- PUBLIC -- */
  var API = {
    isMock: MOCK,
    isSnapshot: false,
    endpoint: ENDPOINT,

    load: function (opts) {
      if (MOCK) return loadSnapshot();
      opts = opts || {};
      return fetchData(!!opts.force).then(function (payload) {
        if (!payload || payload.ok === false) {
          throw new Error((payload && payload.error) || "Respons tidak valid");
        }
        state.version = String(payload.v || "");
        state.lastFull = Date.now();
        return payload;
      });
    },

    check: function () {
      if (state.inflight) return Promise.resolve(null);
      state.inflight = true;
      var stale = Date.now() - state.lastFull > FULL_REFRESH_MS;

      /* Satu permintaan saja per putaran: ambil data lengkap lalu bandingkan
         versinya di browser. Lebih cepat daripada ping lalu ambil data,
         karena setiap permintaan ke Apps Script butuh ~2 detik. */
      return fetchData(false)
        .then(function (payload) {
          if (!payload || payload.ok === false) throw new Error("data gagal");
          var changed = String(payload.v || "") !== state.version;
          state.inflight = false;

          if (changed || stale) {
            state.version = String(payload.v || "");
            state.lastFull = Date.now();
            if (state.handlers.data) state.handlers.data(payload);
            if (state.handlers.status) state.handlers.status("ok", { mock: MOCK, at: new Date() });
            return payload;
          }
          if (state.handlers.status) state.handlers.status("ok", { mock: MOCK, at: new Date() });
          return null;
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

      function schedule(ms) {
        clearTimeout(state.timer);
        state.timer = setTimeout(tick, Math.max(0, ms));
      }

      /* Jeda dihitung dari saat permintaan SEBELUMNYA dimulai. Kalau Apps Script
         butuh ~3 detik, putaran berikutnya langsung jalan 200 ms setelah selesai,
         jadi tidak menunggu dua kali lipat (2 dtk + 3 dtk). */
      function tick() {
        if (document.hidden) { schedule(POLL_MS); return; }

        if (MOCK) {
          if (SNAPSHOT) {
            if (state.handlers.status) state.handlers.status("snapshot", { mock: true, at: new Date() });
          } else {
            MOCK_DATA.tick();
            if (state.handlers.data) state.handlers.data(MOCK_DATA.payload(true));
            if (state.handlers.status) state.handlers.status("ok", { mock: true, at: new Date() });
          }
          schedule(POLL_MS);
          return;
        }

        var t0 = Date.now();
        self.check()
          .catch(function () { /* status sudah dilaporkan */ })
          .then(function () {
            schedule(POLL_MS - (Date.now() - t0));
          });
      }

      if (state.handlers.status) state.handlers.status(MOCK ? "mock" : "connecting", { mock: MOCK, at: new Date() });
      schedule(POLL_MS);
    },

    stop: function () {
      clearTimeout(state.timer);
      state.timer = null;
    },

    refresh: function () {
      return this.load({ force: true });
    }
  };

  global.DATA_API = API;
})(window);
