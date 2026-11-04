/* ============================================================================
   DATA LAYER
   ----------------------------------------------------------------------------
   - Apps Script Web App lewat JSONP (bebas CORS)
   - Aksi: state · hostState · answer · host
   - Mode demo otomatis di localhost/file:// atau dengan ?demo=1
   ========================================================================== */
(function (global) {
  "use strict";

  var CFG = global.APP_CONFIG || {};
  var ENDPOINT = (CFG.API_URL || "").trim();
  var seq = 0;

  function param(name) {
    try {
      return new URLSearchParams(global.location.search).get(name);
    } catch (e) { return null; }
  }

  function isDemoMode() {
    if (CFG.DEMO === true) return true;
    if (CFG.DEMO === false) return false;
    if (param("demo") === "1") return true;
    if (param("demo") === "0") return false;   // paksa live (untuk uji lokal)
    if (!ENDPOINT) return true;
    var host = global.location.hostname;
    return global.location.protocol === "file:" ||
      host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "";
  }

  var DEMO = isDemoMode();

  if (DEMO && global.DEMO_BACKEND && param("reset") === "1") {
    global.DEMO_BACKEND.reset();
  }

  /* ------------------------------------------------------------------ ID -- */
  function makeId() {
    try {
      if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    } catch (ignore) { /* lanjut */ }
    var s = "";
    for (var i = 0; i < 4; i++) {
      s += Math.random().toString(36).slice(2, 8);
    }
    return "r-" + s;
  }

  var RID_KEY = "th_rid_v1";
  var RID = "";
  try {
    RID = global.localStorage.getItem(RID_KEY) || "";
    if (!RID) {
      RID = makeId();
      global.localStorage.setItem(RID_KEY, RID);
    }
  } catch (e) {
    RID = makeId();
  }

  /* ----------------------------------------------------------------- PIN -- */
  var PIN_KEY = "th_host_pin";
  var pinFromUrl = param("pin");
  if (pinFromUrl) {
    try { global.sessionStorage.setItem(PIN_KEY, pinFromUrl); } catch (ignore) { /* abaikan */ }
  }

  function getPin() {
    try { return global.sessionStorage.getItem(PIN_KEY) || ""; } catch (e) { return ""; }
  }
  function setPin(pin) {
    try {
      if (pin) global.sessionStorage.setItem(PIN_KEY, pin);
      else global.sessionStorage.removeItem(PIN_KEY);
    } catch (ignore) { /* abaikan */ }
  }

  /* ---------------------------------------------------------------- JSONP -- */
  function jsonp(params, timeout) {
    return new Promise(function (resolve, reject) {
      var name = "__th_cb_" + Date.now().toString(36) + "_" + (++seq);
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
        reject(new Error("Waktu habis — server tidak merespons"));
      }, timeout || 20000);

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
        reject(new Error("Gagal terhubung ke server"));
      };

      script.src = ENDPOINT + (ENDPOINT.indexOf("?") === -1 ? "?" : "&") +
        qs.join("&") + "&_t=" + Date.now();
      document.head.appendChild(script);
    });
  }

  /* ---------------------------------------------------------------- CALL -- */
  function call(action, params) {
    params = params || {};

    if (DEMO) {
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          try {
            if (!global.DEMO_BACKEND) throw new Error("Modul demo tidak ditemukan");
            resolve(global.DEMO_BACKEND.call(action, params));
          } catch (err) {
            reject(new Error(String((err && err.message) || err)));
          }
        }, 140 + Math.random() * 220);
      });
    }

    params.action = action;
    return jsonp(params, 20000).then(function (payload) {
      if (!payload || payload.ok === false) {
        throw new Error((payload && payload.error) || "Respons server tidak valid");
      }
      if ((action === "state" || action === "hostState") && !payload.session) {
        throw new Error("Backend belum mendukung mode survei — deploy ulang Apps Script.");
      }
      return payload;
    });
  }

  /* ----------------------------------------------------------------- API -- */
  var API = {
    isDemo: DEMO,
    endpoint: ENDPOINT,
    rid: RID,

    getPin: getPin,
    setPin: setPin,

    state: function () {
      return call("state", { rid: RID });
    },

    hostState: function () {
      return call("hostState", { pin: getPin() });
    },

    answer: function (qid, value) {
      return call("answer", { rid: RID, qid: qid, value: value });
    },

    host: function (op, extra) {
      var p = { op: op, pin: getPin() };
      if (extra) {
        Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
      }
      return call("host", p);
    },

    ping: function () {
      return call("ping", {});
    },

    /* Polling tanpa tumpang tindih; berhenti saat tab tidak terlihat.
       `interval` boleh berupa angka atau fungsi (interval adaptif).
       Jeda diberi variasi ±20% agar 200 peserta tidak membanjiri server
       pada detik yang sama. */
    poll: function (fn, interval) {
      var stopped = false;
      var busy = false;
      var timer = null;

      function nextMs() {
        var base = typeof interval === "function" ? interval() : interval;
        base = Number(base) || 5000;
        var jitter = base * 0.2 * (Math.random() * 2 - 1);
        return Math.max(800, Math.round(base + jitter));
      }

      function schedule(ms) {
        clearTimeout(timer);
        timer = setTimeout(loop, Math.max(600, ms));
      }

      function loop() {
        if (stopped) return;
        if (document.hidden) { schedule(nextMs()); return; }
        if (busy) { schedule(nextMs()); return; }

        busy = true;
        Promise.resolve()
          .then(fn)
          .catch(function () { /* status ditangani pemanggil */ })
          .then(function () {
            busy = false;
            if (!stopped) schedule(nextMs());
          });
      }

      function onVisible() {
        if (!document.hidden) {
          clearTimeout(timer);
          loop();
        }
      }

      document.addEventListener("visibilitychange", onVisible);
      loop();

      return {
        stop: function () {
          stopped = true;
          clearTimeout(timer);
          document.removeEventListener("visibilitychange", onVisible);
        },
        now: function () {
          clearTimeout(timer);
          loop();
        }
      };
    }
  };

  global.DATA_API = API;
})(window);
