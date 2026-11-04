/* ============================================================================
   LAYAR PESERTA
   Satu pertanyaan pada satu waktu. Setelah host menampilkan hasil, peserta
   melihat distribusi jawaban dan menunggu pertanyaan berikutnya.
   ========================================================================== */
(function (global) {
  "use strict";

  var CFG = global.APP_CONFIG || {};
  var SURVEY = global.SURVEY || {};
  var FMT = global.FMT || {};
  var API = global.DATA_API;
  var QS = SURVEY.questions || [];
  var POLL = CFG.POLL_MS_PARTICIPANT || 5000;

  var stage = document.getElementById("stage");
  var banner = document.getElementById("banner");
  var bannerText = document.getElementById("bannerText");

  var state = {
    data: null,
    key: "",
    selected: null,
    submitting: false,
    answeredLocal: {},
    poll: null
  };

  function esc(v) { return FMT.esc ? FMT.esc(v) : String(v == null ? "" : v); }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function qAt(i) { return QS[i] || null; }
  function num(v) { return FMT.num ? FMT.num(v) : String(v); }

  function scaleLabel(q, v) {
    var scale = SURVEY.scaleFor ? SURVEY.scaleFor(q.max) : (SURVEY.scale6 || []);
    for (var i = 0; i < scale.length; i++) {
      if (Number(scale[i].v) === Number(v)) return scale[i].label;
    }
    return "";
  }

  function countOf(result, v) {
    if (!result || !result.counts) return 0;
    return Number(result.counts[String(v)] || 0);
  }

  /* --------------------------------------------------------------- VIEWS -- */
  function landingHTML() {
    var total = QS.length;
    return '<div class="p-view">' +
      '<p class="eyebrow">' + esc(CFG.ORG || SURVEY.org || "Town Hall") + '</p>' +
      '<h1>' + esc(CFG.TITLE || SURVEY.title || "Survey Town Hall Meeting Dosen") + '</h1>' +
      '<p class="lead">' + esc(SURVEY.intro || "Survey ini anonim.") +
        ' Host membuka satu pertanyaan pada satu waktu, lalu hasilnya langsung dibahas bersama.</p>' +
      '<div class="p-facts">' +
        '<div><b>' + total + '</b><span>pertanyaan</span></div>' +
        '<div><b>±5</b><span>menit</span></div>' +
        '<div><b>Anonim</b><span>tanpa nama</span></div>' +
      '</div>' +
      '<p class="wait"><i class="dot" aria-hidden="true"></i>Menunggu host memulai sesi…</p>' +
      '</div>';
  }

  function questionHTML(data, q) {
    var sess = data.session;
    var prompt = q.type === "choice"
      ? "Pilih satu aktivitas."
      : "Pilih satu angka: 1 = sangat tidak penting, " + q.max + " = sangat penting.";

    var body;
    if (q.type === "choice") {
      body = '<div class="choices" role="radiogroup" aria-label="Pilihan jawaban">' +
        q.options.map(function (label, i) {
          return '<button type="button" class="ch" role="radio" aria-checked="false" data-v="' + (i + 1) + '">' +
            '<i aria-hidden="true"></i><span>' + esc(label) + '</span></button>';
        }).join("") +
        '</div>';
    } else {
      body = '<div class="scale" role="radiogroup" aria-label="Skala 1 sampai ' + q.max + '">' +
        (SURVEY.scaleFor ? SURVEY.scaleFor(q.max) : []).map(function (o) {
          return '<button type="button" class="sc" role="radio" aria-checked="false" data-v="' + o.v + '">' +
            '<b>' + o.v + '</b><span>' + esc(o.label) + '</span></button>';
        }).join("") +
        '</div>';
    }

    return '<div class="p-view" data-qid="' + esc(q.id) + '">' +
      '<p class="eyebrow"><b>' + pad(sess.current + 1) + '</b> / ' + pad(QS.length) +
        ' &nbsp;·&nbsp; ' + (q.type === "choice" ? "Pilih satu" : "Skala 1–" + q.max) + '</p>' +
      '<h1 class="qtext">' + esc(q.text) + '</h1>' +
      '<p class="micro">' + esc(prompt) + '</p>' +
      body +
      '<div class="p-actions">' +
        '<p class="selection" id="selection">Belum ada pilihan.</p>' +
        '<button class="btn btn--primary" id="submit" type="button" disabled>Kirim jawaban</button>' +
      '</div>' +
      '<p class="micro">Jawaban tidak dapat diubah setelah dikirim.</p>' +
      '</div>';
  }

  function waitingHTML(data, q) {
    return '<div class="p-view p-view--narrow p-done">' +
      '<div class="tick" aria-hidden="true">✓</div>' +
      '<p class="eyebrow">Jawaban tercatat &nbsp;·&nbsp; Pertanyaan ' +
        (data.session.current + 1) + ' dari ' + QS.length + '</p>' +
      '<h1>Terima kasih.</h1>' +
      '<p class="lead">Jawaban Anda sudah masuk. Host akan menampilkan hasil pertanyaan ini, lalu membuka pertanyaan berikutnya.</p>' +
      '<div class="p-stat"><b id="waitCount">' + num(data.answeredCurrent || 0) + '</b>' +
        '<span>dosen sudah menjawab pertanyaan ini</span></div>' +
      '<p class="wait"><i class="dot" aria-hidden="true"></i>Menunggu host menampilkan hasil…</p>' +
      '</div>';
  }

  function resultRowsHTML(q) {
    if (q.type === "choice") {
      return q.options.map(function (label, i) {
        var v = i + 1;
        return '<div class="rrow rrow--choice" data-v="' + v + '">' +
          '<div class="rrow__wrap"><span class="rrow__l">' + esc(label) + '</span>' +
          '<div class="rrow__t"><u></u></div></div>' +
          '<b class="rrow__p">0%</b><i class="rrow__c">0</i></div>';
      }).join("");
    }
    return (SURVEY.scaleFor ? SURVEY.scaleFor(q.max) : []).map(function (o) {
      return '<div class="rrow" data-v="' + o.v + '">' +
        '<span class="rrow__l">' + o.v + '</span>' +
        '<div class="rrow__t"><u></u></div>' +
        '<b class="rrow__p">0%</b><i class="rrow__c">0</i></div>';
    }).join("");
  }

  function resultsHTML(data, q) {
    var finalNote = data.session.status === "done"
      ? "Sesi selesai. Terima kasih atas partisipasi Anda."
      : "Menunggu pertanyaan berikutnya…";

    return '<div class="p-view">' +
      '<p class="eyebrow"><b>Hasil</b> &nbsp;·&nbsp; Pertanyaan ' + (data.session.current + 1) +
        ' dari ' + QS.length + '</p>' +
      '<h1 class="qtext">' + esc(q.text) + '</h1>' +
      '<div class="res">' +
        '<div class="res__head">' +
          '<div class="res__big" id="resBig">0<span>%</span></div>' +
          '<p class="res__cap"><b id="resCap">—</b><span id="resSub">Belum ada jawaban.</span></p>' +
        '</div>' +
        '<div class="res__list" id="resList">' + resultRowsHTML(q) + '</div>' +
      '</div>' +
      '<p class="wait res__wait"><i class="dot" aria-hidden="true"></i>' + esc(finalNote) + '</p>' +
      '</div>';
  }

  function doneHTML(data) {
    return '<div class="p-view p-view--narrow p-done">' +
      '<div class="tick" aria-hidden="true">✓</div>' +
      '<p class="eyebrow">Sesi selesai</p>' +
      '<h1>Terima kasih.</h1>' +
      '<p class="lead">Partisipasi Anda sudah tercatat. Hasil lengkap akan dibahas host di ruang meeting.</p>' +
      '<div class="p-stat"><b>' + num(data.respondents || 0) + '</b>' +
        '<span>dosen berpartisipasi</span></div>' +
      '</div>';
  }

  /* --------------------------------------------------------------- PAINT -- */
  function render(data, answered) {
    var sess = data.session;
    var q = qAt(sess.current);

    if (sess.status === "idle" || !q) {
      stage.innerHTML = landingHTML();
      return;
    }
    if (sess.status === "done") {
      stage.innerHTML = doneHTML(data);
      return;
    }
    if (sess.status === "revealed") {
      stage.innerHTML = resultsHTML(data, q);
      paintResults(data);
      return;
    }
    /* open */
    stage.innerHTML = answered ? waitingHTML(data, q) : questionHTML(data, q);
  }

  function paintResults(data) {
    var q = qAt(data.session.current);
    if (!q) return;

    var r = data.result || { n: 0, counts: {} };
    var total = Number(r.n || 0);
    var rows = stage.querySelectorAll("#resList .rrow");
    var topV = null;
    var topC = -1;

    rows.forEach(function (row) {
      var v = Number(row.getAttribute("data-v"));
      var c = countOf(r, v);
      var pct = total ? (c / total) * 100 : 0;

      row.querySelector("u").style.width = pct + "%";
      row.querySelector(".rrow__p").textContent = total ? Math.round(pct) + "%" : "0%";
      row.querySelector(".rrow__c").textContent = c;

      if (c > topC || (c === topC && v > topV)) {
        topC = c;
        topV = v;
      }
    });

    rows.forEach(function (row) {
      row.classList.toggle("top", Number(row.getAttribute("data-v")) === topV && topC > 0);
    });

    var big = document.getElementById("resBig");
    var cap = document.getElementById("resCap");
    var sub = document.getElementById("resSub");
    if (!big || !cap || !sub) return;

    if (!total || topV == null) {
      big.innerHTML = '0<span>%</span>';
      cap.textContent = "Belum ada jawaban";
      sub.textContent = "Menunggu peserta menjawab.";
      return;
    }

    var share = Math.round((topC / total) * 100);
    big.innerHTML = share + '<span>%</span>';

    if (q.type === "choice") {
      cap.textContent = q.options[topV - 1] || "—";
    } else {
      cap.textContent = "Angka " + topV + " — " + scaleLabel(q, topV);
    }
    sub.textContent = "paling banyak dipilih · " + topC + " dari " + total + " dosen";
  }

  function update(data, answered) {
    var sess = data.session;

    if (sess.status === "revealed") {
      paintResults(data);
      return;
    }

    if (sess.status === "open" && answered) {
      var el = document.getElementById("waitCount");
      if (el) el.textContent = num(data.answeredCurrent || 0);
    }
  }

  function updateFoot(data) {
    var meta = document.getElementById("footMeta");
    if (!meta) return;
    if (!data || !data.session) {
      meta.textContent = QS.length + " pertanyaan · anonim";
      return;
    }
    var sess = data.session;
    if (sess.status === "open" || sess.status === "revealed") {
      meta.textContent = "Pertanyaan " + (sess.current + 1) + " dari " + QS.length;
    } else if (sess.status === "done") {
      meta.textContent = "Sesi selesai";
    } else {
      meta.textContent = QS.length + " pertanyaan · anonim";
    }
  }

  /* --------------------------------------------------------------- STATE -- */
  function apply(data, force) {
    var sess = data.session;
    var q = qAt(sess.current);
    var answered = !!(q && (
      (data.myAnswered || []).indexOf(q.id) !== -1 || state.answeredLocal[q.id]
    ));
    var key = [sess.status, sess.current, sess.revealed ? 1 : 0, answered ? 1 : 0].join("|");

    if (force || key !== state.key) {
      state.key = key;
      state.selected = null;
      render(data, answered);
      updateFoot(data);
    } else {
      update(data, answered);
      updateFoot(data);
    }
  }

  function handle(data) {
    if (!data || !data.session) throw new Error("Data sesi tidak valid");
    state.data = data;
    setConnected(true);
    hideBanner();
    apply(data, false);
  }

  /* Interval adaptif: belum mulai = lambat, sesi berjalan = normal,
     selesai = sangat lambat. Menekan jumlah permintaan saat 200 peserta. */
  function pollInterval() {
    var s = state.data && state.data.session;
    if (!s) return 15000;
    if (s.status === "idle") return 15000;
    if (s.status === "done") return 30000;
    return POLL;
  }

  function refresh() {
    return API.state().then(handle).catch(function (err) {
      setConnected(false);
      showBanner(err && err.message ? err.message : "Koneksi terputus.");
      if (!state.data) {
        stage.innerHTML = '<div class="p-view p-view--narrow">' +
          '<p class="eyebrow">Koneksi</p>' +
          '<h1>Data belum bisa dimuat.</h1>' +
          '<p class="lead">' + esc(err.message || "Periksa koneksi lalu coba lagi.") + '</p>' +
          '<button class="btn btn--primary" id="stageRetry" type="button">Coba lagi</button>' +
          '</div>';
      }
    });
  }

  function setConnected(ok) {
    var el = document.getElementById("conn");
    if (!el) return;
    el.classList.toggle("is-off", !ok);
    el.classList.toggle("is-demo", !!API.isDemo && ok);
    var label = el.querySelector("span");
    if (label) label.textContent = ok ? (API.isDemo ? "Demo" : "Live") : "Terputus";
  }

  function showBanner(msg) {
    if (!banner || !bannerText) return;
    bannerText.textContent = msg;
    banner.hidden = false;
  }
  function hideBanner() {
    if (banner) banner.hidden = true;
  }

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 4500);
  }

  /* --------------------------------------------------------------- EVENTS -- */
  function select(btn) {
    if (state.submitting) return;
    var v = Number(btn.getAttribute("data-v"));
    var q = qAt(state.data.session.current);
    if (!q || !isFinite(v)) return;

    state.selected = v;
    stage.querySelectorAll(".sc, .ch").forEach(function (el) {
      var on = el === btn;
      el.classList.toggle("on", on);
      el.setAttribute("aria-checked", on ? "true" : "false");
    });

    var selection = document.getElementById("selection");
    if (selection) {
      var label = q.type === "choice" ? q.options[v - 1] : v + " — " + scaleLabel(q, v);
      selection.innerHTML = 'Dipilih: <b>' + esc(label) + '</b>';
    }

    var submit = document.getElementById("submit");
    if (submit) submit.disabled = false;
  }

  function submitAnswer() {
    var q = qAt(state.data.session.current);
    if (!q || state.selected == null || state.submitting) return;

    var value = state.selected;
    var submit = document.getElementById("submit");
    state.submitting = true;
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Mengirim…";
    }

    API.answer(q.id, value).then(function (res) {
      if (res && res.ok === false) throw new Error(res.error || "Gagal mengirim");
      state.answeredLocal[q.id] = true;
      state.selected = null;
      apply(state.data, true);
      if (state.poll) state.poll.now();
    }).catch(function (err) {
      toast("Jawaban gagal dikirim. " + (err && err.message ? err.message : "Coba lagi."));
      if (submit) {
        submit.disabled = false;
        submit.textContent = "Kirim jawaban";
      }
    }).then(function () {
      state.submitting = false;
    });
  }

  function onClick(e) {
    var t = e.target;

    if (t.closest("#bannerRetry") || t.closest("#stageRetry")) {
      refresh();
      return;
    }

    var pick = t.closest(".sc, .ch");
    if (pick && stage.contains(pick)) {
      select(pick);
      return;
    }

    if (t.closest("#submit")) submitAnswer();
  }

  /* ----------------------------------------------------------------- BOOT -- */
  function boot() {
    var brand = document.getElementById("brandName");
    if (brand) brand.textContent = CFG.TITLE || SURVEY.title || "Survey";
    if (CFG.TITLE) document.title = CFG.TITLE;

    var demoLink = document.getElementById("bannerDemo");
    if (demoLink && API.isDemo) demoLink.hidden = true;

    document.addEventListener("click", onClick);

    if (API.isDemo) {
      setConnected(true);
      var el = document.getElementById("conn");
      if (el) {
        var label = el.querySelector("span");
        if (label) label.textContent = "Demo";
        el.classList.add("is-demo");
      }
    }

    state.poll = API.poll(refresh, pollInterval);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
