/* ============================================================================
   LAYAR HOST
   Mengendalikan alur: buka pertanyaan → tampilkan hasil → lanjut.
   Data jawaban diperbarui setiap beberapa detik (realtime polling).
   ========================================================================== */
(function (global) {
  "use strict";

  var CFG = global.APP_CONFIG || {};
  var SURVEY = global.SURVEY || {};
  var FMT = global.FMT || {};
  var API = global.DATA_API;
  var QS = SURVEY.questions || [];
  var POLL = CFG.POLL_MS_HOST || 2500;

  var stage = document.getElementById("hStage");
  var gate = document.getElementById("pinGate");
  var pinForm = document.getElementById("pinForm");
  var pinInput = document.getElementById("pinInput");
  var pinErr = document.getElementById("pinErr");
  var pinSubmit = document.getElementById("pinSubmit");
  var pinHint = document.getElementById("pinHint");
  var hList = document.getElementById("hList");
  var toastEl = document.getElementById("toast");

  var state = {
    data: null,
    key: "",
    railBuilt: false,
    authed: false,
    busy: false,
    poll: null,
    lastToast: 0
  };

  function esc(v) { return FMT.esc ? FMT.esc(v) : String(v == null ? "" : v); }
  function num(v) { return FMT.num ? FMT.num(v) : String(v); }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function qAt(i) { return QS[i] || null; }

  function clockText() {
    try {
      return new Date().toLocaleTimeString(CFG.LOCALE || "id-ID", {
        hour: "2-digit", minute: "2-digit"
      });
    } catch (e) {
      var d = new Date();
      return pad(d.getHours()) + ":" + pad(d.getMinutes());
    }
  }

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.hidden = true; }, 4200);
  }

  function toastThrottled(msg) {
    var t = Date.now();
    if (t - state.lastToast < 8000) return;
    state.lastToast = t;
    toast(msg);
  }

  /* ----------------------------------------------------------------- PIN -- */
  function showGate(msg) {
    document.body.classList.add("locked");
    if (gate) gate.hidden = false;
    if (pinErr) {
      pinErr.hidden = !msg;
      pinErr.textContent = msg || "";
    }
    setTimeout(function () { if (pinInput) pinInput.focus(); }, 60);
  }

  function hideGate() {
    document.body.classList.remove("locked");
    if (gate) gate.hidden = true;
  }

  function verify(pin) {
    if (!pin) {
      showGate("Masukkan PIN host.");
      return Promise.resolve(false);
    }

    pinSubmit.disabled = true;
    pinSubmit.textContent = "Memeriksa…";
    API.setPin(pin);

    return API.hostState().then(function (data) {
      if (!data || !data.session) throw new Error("Respons host tidak valid");
      state.authed = true;
      state.key = "";
      hideGate();
      if (pinInput) pinInput.value = "";
      enter(data);
      if (!state.poll) state.poll = API.poll(tick, POLL);
      return true;
    }).catch(function (err) {
      API.setPin("");
      var msg = /pin/i.test(String(err && err.message))
        ? "PIN salah. Coba lagi."
        : (err && err.message) || "Gagal masuk.";
      showGate(msg);
      return false;
    }).then(function (ok) {
      pinSubmit.disabled = false;
      pinSubmit.textContent = "Masuk";
      return ok;
    });
  }

  function lock(reason) {
    state.authed = false;
    if (state.poll) {
      state.poll.stop();
      state.poll = null;
    }
    API.setPin("");
    showGate(reason || "Sesi host berakhir. Masukkan PIN lagi.");
  }

  /* --------------------------------------------------------------- DATA -- */
  function tick() {
    if (!state.authed) return Promise.resolve();
    return API.hostState().then(handle).catch(function (err) {
      if (/pin/i.test(String(err && err.message))) {
        lock("PIN salah. Masukkan PIN lagi.");
      } else {
        toastThrottled("Koneksi terputus — mencoba lagi otomatis…");
      }
    });
  }

  function enter(data) {
    if (!state.railBuilt) {
      buildRail();
      state.railBuilt = true;
    }
    handle(data);
  }

  function handle(data) {
    if (!data || !data.session) return;
    state.data = data;

    updateMetrics(data);
    updateStatus(data);
    if (!state.railBuilt) {
      buildRail();
      state.railBuilt = true;
    }
    updateRail(data);

    var key = [data.session.status, data.session.current, data.session.revealed ? 1 : 0].join("|");
    if (key !== state.key) {
      state.key = key;
      renderStage(data);
    } else {
      updateStage(data);
    }
  }

  function updateMetrics(data) {
    var resp = document.getElementById("hResp");
    var ans = document.getElementById("hAns");
    var live = document.getElementById("hLive");
    var idleP = document.getElementById("idlePeople");

    if (resp) resp.textContent = num(data.respondents || 0);
    if (ans) ans.textContent = num(data.answers || 0);
    if (live) {
      live.classList.toggle("is-idle",
        data.session.status === "idle" || data.session.status === "done");
    }
    if (idleP) idleP.textContent = num(data.respondents || 0);
  }

  function updateStatus(data) {
    var el = document.getElementById("hStatus");
    var sub = document.getElementById("hStatusSub");
    if (!el || !sub) return;

    var s = data.session;
    el.classList.toggle("is-live", s.status === "open" || s.status === "revealed");

    if (s.status === "idle") {
      el.textContent = "Belum dimulai";
      sub.textContent = "Tekan mulai untuk membuka pertanyaan pertama.";
    } else if (s.status === "open") {
      el.textContent = "Menerima jawaban";
      sub.textContent = "Pertanyaan " + (s.current + 1) + " terbuka · " +
        num(data.answeredCurrent || 0) + " jawaban masuk.";
    } else if (s.status === "revealed") {
      el.textContent = "Hasil ditampilkan";
      sub.textContent = "Peserta melihat hasil pertanyaan " + (s.current + 1) +
        ". Lanjut bila diskusi selesai.";
    } else {
      el.textContent = "Sesi selesai";
      sub.textContent = "Semua pertanyaan sudah dibahas.";
    }
  }

  /* --------------------------------------------------------------- RAIL -- */
  function buildRail() {
    if (!hList) return;
    hList.innerHTML = QS.map(function (q, i) {
      return '<li><button type="button" class="hq" data-q="' + i + '">' +
        '<span class="hq__i">' + pad(i + 1) + '</span>' +
        '<span class="hq__t">' + esc(q.short || q.text) + '</span>' +
        '<span class="hq__n">0</span>' +
        '</button></li>';
    }).join("");
  }

  function updateRail(data) {
    if (!hList) return;
    var buttons = hList.querySelectorAll(".hq");
    var s = data.session;

    buttons.forEach(function (btn) {
      var i = Number(btn.getAttribute("data-q"));
      var q = qAt(i);
      var r = q && data.results ? data.results[q.id] : null;
      var n = r ? r.n : 0;

      btn.querySelector(".hq__n").textContent = num(n);
      btn.classList.toggle("on", i === s.current);
      btn.classList.toggle("live", i === s.current && s.status === "open");
    });
  }

  /* --------------------------------------------------------------- STAGE -- */
  function chartRowsHTML(q) {
    if (q.type === "choice") {
      return q.options.map(function (label, i) {
        var v = i + 1;
        return '<div class="hrow" data-v="' + v + '">' +
          '<div class="hrow__top">' +
            '<span class="hrow__l"><b>' + pad(v) + '</b>' + esc(label) + '</span>' +
            '<span class="hrow__c">0</span><span class="hrow__p">0%</span>' +
          '</div>' +
          '<div class="hrow__t"><u></u></div>' +
          '</div>';
      }).join("");
    }

    return (SURVEY.scaleFor ? SURVEY.scaleFor(q.max) : []).map(function (o) {
      return '<div class="hrow" data-v="' + o.v + '">' +
        '<div class="hrow__top">' +
          '<span class="hrow__l"><b>' + pad(o.v) + '</b>' + esc(o.label) + '</span>' +
          '<span class="hrow__c">0</span><span class="hrow__p">0%</span>' +
        '</div>' +
        '<div class="hrow__t"><u></u></div>' +
        '</div>';
    }).join("");
  }

  function actionsHTML(data) {
    var last = data.session.current === QS.length - 1;

    if (data.session.status === "open") {
      return '<button class="btn btn--primary" type="button" data-act="reveal">Tampilkan hasil ke peserta</button>' +
        '<button class="btn btn--ghost" type="button" data-act="next">' +
        (last ? "Selesaikan sesi" : "Lewati ke pertanyaan berikutnya") + '</button>';
    }

    return '<button class="btn btn--primary" type="button" data-act="next">' +
      (last ? "Selesaikan sesi" : "Pertanyaan berikutnya →") + '</button>' +
      '<button class="btn btn--ghost" type="button" data-act="hide">Sembunyikan hasil</button>' +
      '<button class="btn btn--ghost" type="button" data-act="reopen">Buka lagi untuk jawaban</button>';
  }

  function questionHTML(data) {
    var s = data.session;
    var q = qAt(s.current);
    if (!q) return '<div class="boot">Pertanyaan tidak ditemukan.</div>';

    var revealed = s.status === "revealed";
    var pill = '<span class="pill ' + (revealed ? "pill--done" : "pill--live") + '" id="hPill">' +
      (revealed ? "Hasil tampil" : "Menerima jawaban") + '</span>';

    return '<div class="hv">' +
      '<div class="hv__head">' +
        '<p class="eyebrow">Pertanyaan ' + (s.current + 1) + ' dari ' + QS.length +
          ' &nbsp;·&nbsp; ' + (q.type === "choice" ? "Pilih satu" : "Skala 1–" + q.max) +
          ' ' + pill + '</p>' +
        '<h1>' + esc(q.text) + '</h1>' +
      '</div>' +
      '<div class="hv__body">' +
        '<div class="hchart' + (q.type === "choice" ? " hchart--choice" : "") + '" id="hChart">' +
          chartRowsHTML(q) +
        '</div>' +
        '<aside class="hside">' +
          '<div class="hcount">' +
            '<b id="hCurCount">0</b>' +
            '<span>jawaban pertanyaan ini</span>' +
            '<small id="hCurOf">dari 0 responden</small>' +
          '</div>' +
          '<div class="htop">' +
            '<span class="eyebrow">Paling banyak</span>' +
            '<strong id="hTop">—</strong>' +
            '<span class="htop__sub" id="hTopSub">Belum ada jawaban.</span>' +
          '</div>' +
          '<div class="hactions" id="hActions">' + actionsHTML(data) + '</div>' +
        '</aside>' +
      '</div>' +
      '</div>';
  }

  function idleHTML() {
    return '<div class="hidle">' +
      '<p class="eyebrow">Siap memulai</p>' +
      '<h1>' + esc(CFG.TITLE || "Survey Town Hall Meeting Dosen") + '</h1>' +
      '<p class="lead">' + QS.length + ' pertanyaan · jawaban anonim · hasil tampil realtime. ' +
        'Peserta memindai QR di kiri untuk bergabung, lalu host membuka satu pertanyaan setiap putaran.</p>' +
      '<div class="hidle__facts">' +
        '<div><b>' + QS.length + '</b><span>pertanyaan</span></div>' +
        '<div><b id="idlePeople">0</b><span>responden</span></div>' +
        '<div><b>1–6</b><span>skala penting</span></div>' +
      '</div>' +
      '<button class="btn btn--primary" type="button" data-act="start">Mulai pertanyaan 1 →</button>' +
      '</div>';
  }

  function doneHTML(data) {
    var cards = QS.map(function (q, i) {
      var r = data.results ? data.results[q.id] : null;
      var n = r ? r.n : 0;
      return '<div class="hdone__card">' +
        '<span class="eyebrow">' + pad(i + 1) + '</span>' +
        '<b>' + num(n) + '</b>' +
        '<span>' + esc(q.short || q.text) + '</span>' +
        '</div>';
    }).join("");

    return '<div class="hdone">' +
      '<p class="eyebrow">Sesi selesai</p>' +
      '<h1>Terima kasih.</h1>' +
      '<p class="lead">' + num(data.respondents || 0) + ' dosen berpartisipasi · ' +
        num(data.answers || 0) + ' jawaban terkumpul.</p>' +
      '<div class="hdone__grid">' + cards + '</div>' +
      '<div class="hactions hdone__actions">' +
        '<button class="btn btn--primary" type="button" data-act="reset">Mulai sesi baru</button>' +
        '<button class="btn btn--ghost" type="button" data-act="last">Lihat hasil terakhir</button>' +
      '</div>' +
      '</div>';
  }

  function renderStage(data) {
    var s = data.session;
    if (s.status === "idle") {
      stage.innerHTML = idleHTML();
      updateMetrics(data);
      return;
    }
    if (s.status === "done") {
      stage.innerHTML = doneHTML(data);
      return;
    }
    stage.innerHTML = questionHTML(data);
    updateStage(data);
  }

  function valueLabel(q, v) {
    if (q.type === "choice") return q.options[v - 1] || "—";
    var scale = SURVEY.scaleFor ? SURVEY.scaleFor(q.max) : [];
    for (var i = 0; i < scale.length; i++) {
      if (Number(scale[i].v) === Number(v)) return "Angka " + v + " — " + scale[i].label;
    }
    return "Angka " + v;
  }

  function updateStage(data) {
    var s = data.session;
    if (s.status === "idle" || s.status === "done") {
      if (s.status === "idle") updateMetrics(data);
      return;
    }

    var q = qAt(s.current);
    if (!q) return;

    var r = (data.results && data.results[q.id]) || { n: 0, counts: {} };
    var total = Number(r.n || 0);
    var rows = stage.querySelectorAll("#hChart .hrow");
    var topV = null;
    var topC = -1;

    rows.forEach(function (row) {
      var v = Number(row.getAttribute("data-v"));
      var c = Number((r.counts && r.counts[String(v)]) || 0);
      var pct = total ? (c / total) * 100 : 0;

      row.querySelector("u").style.width = pct + "%";
      row.querySelector(".hrow__p").textContent = total ? Math.round(pct) + "%" : "0%";
      row.querySelector(".hrow__c").textContent = c;

      if (c > topC || (c === topC && v > topV)) {
        topC = c;
        topV = v;
      }
    });

    rows.forEach(function (row) {
      row.classList.toggle("top", Number(row.getAttribute("data-v")) === topV && topC > 0);
    });

    var countEl = document.getElementById("hCurCount");
    var ofEl = document.getElementById("hCurOf");
    var topEl = document.getElementById("hTop");
    var topSub = document.getElementById("hTopSub");

    if (countEl) countEl.textContent = num(total);
    if (ofEl) ofEl.textContent = "dari " + num(data.respondents || 0) + " responden";

    if (topEl && topSub) {
      if (!total || topV == null) {
        topEl.textContent = "—";
        topSub.textContent = "Belum ada jawaban.";
      } else {
        topEl.textContent = valueLabel(q, topV);
        topSub.textContent = Math.round((topC / total) * 100) + "% · " +
          topC + " dari " + total + " jawaban";
      }
    }
  }

  /* -------------------------------------------------------------- ACTIONS -- */
  function hostAction(op, extra) {
    if (state.busy || !state.authed) return;
    state.busy = true;
    API.host(op, extra).then(function (data) {
      if (data && data.session) handle(data);
    }).catch(function (err) {
      if (/pin/i.test(String(err && err.message))) {
        lock("PIN salah. Masukkan PIN lagi.");
      } else {
        toast((err && err.message) || "Perintah gagal.");
      }
    }).then(function () {
      state.busy = false;
    });
  }

  function doReset() {
    if (!state.authed) return;
    if (!global.confirm("Hapus semua jawaban dan mulai sesi baru?")) return;
    hostAction("reset", { clear: "1" });
  }

  function goToQuestion(i) {
    if (!state.authed || !state.data) return;
    if (state.data.session.status === "idle") {
      toast("Mulai sesi terlebih dahulu.");
      return;
    }
    var s = state.data.session;
    if (i === s.current && s.status === "open") return;
    if (i === s.current && s.status === "revealed") return;
    hostAction("goto", { index: i });
  }

  function onStageClick(e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var act = btn.getAttribute("data-act");

    if (act === "start") hostAction("start");
    else if (act === "reveal") hostAction("reveal");
    else if (act === "hide") hostAction("hide");
    else if (act === "next") hostAction("next");
    else if (act === "reopen") {
      if (state.data) hostAction("open", { index: state.data.session.current });
    } else if (act === "reset") doReset();
    else if (act === "last") hostAction("goto", { index: QS.length - 1 });
  }

  function onKey(e) {
    if (!state.authed || !gate || !gate.hidden) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (!state.data) return;

    var s = state.data.session;
    if (e.key === "r" || e.key === "R") {
      if (s.status === "open") hostAction("reveal");
      else if (s.status === "revealed") hostAction("hide");
    } else if (e.key === "ArrowRight") {
      if (s.status === "open" || s.status === "revealed") hostAction("next");
    } else if (e.key === "ArrowLeft") {
      if (s.current > 0) hostAction("goto", { index: Math.max(0, s.current - 1) });
    }
  }

  /* ----------------------------------------------------------------- JOIN -- */
  function setupJoin() {
    var url = CFG.JOIN_URL;
    if (!url) {
      try { url = new URL("index.html", global.location.href).href; }
      catch (e) { url = "index.html"; }
    }
    if (API.isDemo) {
      try {
        var u = new URL(url, global.location.href);
        u.searchParams.set("demo", "1");
        url = u.href;
      } catch (ignore) { /* biarkan */ }
    }

    var code = document.getElementById("joinUrl");
    if (code) {
      // Tampilkan bentuk pendek: tanpa https:// dan tanpa /index.html.
      // Tautan dan QR tetap memakai URL lengkap.
      code.textContent = url
        .replace(/^https?:\/\//, "")
        .replace(/\/index\.html(?=$|[?#])/, "/");
    }
    var open = document.getElementById("joinOpen");
    if (open) open.href = url;

    var box = document.getElementById("qr");
    if (!box) return;

    if (global.QRCode) {
      box.innerHTML = "";
      try {
        new global.QRCode(box, {
          text: url,
          width: 148,
          height: 148,
          colorDark: "#0A0A0A",
          colorLight: "#FFFFFF",
          correctLevel: global.QRCode.CorrectLevel.M
        });
      } catch (e) {
        box.innerHTML = '<span class="qr__fb">QR gagal dibuat.</span>';
      }
    } else {
      box.innerHTML = '<span class="qr__fb">QR tidak tersedia.<br>Buka tautan di bawah.</span>';
    }
  }

  /* ----------------------------------------------------------------- BOOT -- */
  function boot() {
    if (pinHint && API.isDemo) pinHint.hidden = false;

    setupJoin();

    pinForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var pin = (pinInput.value || "").trim();
      if (!pin) { showGate("Masukkan PIN host."); return; }
      verify(pin);
    });

    stage.addEventListener("click", onStageClick);

    if (hList) {
      hList.addEventListener("click", function (e) {
        var btn = e.target.closest(".hq");
        if (!btn) return;
        goToQuestion(Number(btn.getAttribute("data-q")));
      });
    }

    var resetBtn = document.getElementById("resetBtn");
    if (resetBtn) resetBtn.addEventListener("click", doReset);

    var exitBtn = document.getElementById("exitBtn");
    if (exitBtn) {
      exitBtn.addEventListener("click", function () {
        API.setPin("");
        try {
          var url = new URL("index.html", global.location.href);
          if (API.isDemo) url.searchParams.set("demo", "1");
          global.location.href = url.href;
        } catch (e) {
          global.location.href = "index.html";
        }
      });
    }

    document.addEventListener("keydown", onKey);

    var clock = document.getElementById("hClock");
    function paintClock() { if (clock) clock.textContent = clockText(); }
    paintClock();
    setInterval(paintClock, 5000);

    var saved = API.getPin();
    if (saved) verify(saved);
    else showGate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
