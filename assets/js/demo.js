/* ============================================================================
   DEMO BACKEND
   ----------------------------------------------------------------------------
   Meniru bentuk respons Apps Script memakai localStorage. Dipakai saat halaman
   dibuka dari localhost / file:// atau dengan ?demo=1, supaya alur host dan
   peserta bisa dicoba tanpa deploy backend.
   ========================================================================== */
(function (global) {
  "use strict";

  var CFG = global.APP_CONFIG || {};
  var SURVEY = global.SURVEY || {};
  var QS = SURVEY.questions || [];
  var KEY = "th_survey_demo_v3";
  var DEMO_PIN = "1234";

  function now() { return new Date().toISOString(); }

  function blank() {
    return {
      session: {
        status: "idle", current: 0, revealed: false,
        round: 0, startedAt: null, updatedAt: now()
      },
      answers: []
    };
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.session && s.answers) return s;
      }
    } catch (ignore) { /* penyimpanan tidak tersedia */ }
    var fresh = blank();
    save(fresh);
    return fresh;
  }

  function save(s) {
    try { global.localStorage.setItem(KEY, JSON.stringify(s)); } catch (ignore) { /* abaikan */ }
  }

  function resetStorage() {
    try { global.localStorage.removeItem(KEY); } catch (ignore) { /* abaikan */ }
  }

  function currentQ(s) {
    return QS[s.session.current] || QS[0];
  }

  function aggregate(s) {
    var counts = Object.create(null);
    var byRid = Object.create(null);
    var rids = Object.create(null);
    var total = 0;

    s.answers.forEach(function (a) {
      if (!a || !a.rid || !a.qid || !a.value) return;
      rids[a.rid] = 1;
      total++;

      var c = counts[a.qid];
      if (!c) { c = counts[a.qid] = { n: 0, counts: Object.create(null) }; }
      c.n++;
      var k = String(a.value);
      c.counts[k] = (c.counts[k] || 0) + 1;

      var mine = byRid[a.rid];
      if (!mine) { mine = byRid[a.rid] = []; }
      if (mine.indexOf(a.qid) === -1) mine.push(a.qid);
    });

    return {
      respondents: Object.keys(rids).length,
      total: total,
      counts: counts,
      byRid: byRid
    };
  }

  function resultFor(agg, qid) {
    var c = agg.counts[qid] || { n: 0, counts: {} };
    return { n: c.n, counts: c.counts };
  }

  function sessionOut(s) {
    return {
      status: s.session.status,
      current: s.session.current,
      revealed: !!s.session.revealed,
      round: s.session.round,
      total: QS.length,
      startedAt: s.session.startedAt,
      updatedAt: s.session.updatedAt
    };
  }

  function rev(s, agg) {
    return [s.session.status, s.session.current, s.session.revealed ? 1 : 0,
      s.session.round, agg.total, agg.respondents].join(":");
  }

  function publicState(s, rid) {
    var agg = aggregate(s);
    var q = currentQ(s);
    return {
      ok: true,
      demo: true,
      rev: rev(s, agg),
      session: sessionOut(s),
      respondents: agg.respondents,
      answers: agg.total,
      answeredCurrent: q ? (agg.counts[q.id] || { n: 0 }).n : 0,
      myAnswered: (rid && agg.byRid[rid]) ? agg.byRid[rid] : [],
      result: (s.session.status === "revealed" || s.session.status === "done")
        ? resultFor(agg, q && q.id)
        : null
    };
  }

  function sample(q) {
    var weights;
    if (q.type === "choice") weights = [36, 24, 18, 12, 10];
    else if (q.max === 5) weights = [1, 4, 10, 32, 53];
    else if (q.id === "q1") weights = [1, 2, 7, 20, 34, 36];
    else if (q.id === "q2") weights = [1, 2, 5, 22, 36, 34];
    else if (q.id === "q3") weights = [0, 2, 8, 18, 34, 38];
    else weights = [1, 2, 6, 20, 33, 38];

    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var r = Math.random() * total;
    for (i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i + 1;
    }
    return weights.length;
  }

  /* Jawaban simulasi supaya grafik host bergerak seperti audiens sungguhan. */
  function simulate(s) {
    if (CFG.DEMO_AUTOFILL === false) return;
    if (s.session.status !== "open") return;

    var q = currentQ(s);
    if (!q) return;

    var existing = s.answers.filter(function (a) { return a.qid === q.id; }).length;
    if (existing >= 62) return;

    var add = Math.random() < 0.72 ? 1 : 2;
    for (var i = 0; i < add; i++) {
      var rid = "sim-" + (1 + Math.floor(Math.random() * 64));
      var dup = s.answers.some(function (a) {
        return a.rid === rid && a.qid === q.id;
      });
      if (dup) continue;
      s.answers.push({ rid: rid, qid: q.id, value: sample(q), ts: now() });
    }
    s.session.updatedAt = now();
    save(s);
  }

  function hostState(s) {
    var agg = aggregate(s);
    var q = currentQ(s);
    return {
      ok: true,
      demo: true,
      rev: rev(s, agg),
      session: sessionOut(s),
      respondents: agg.respondents,
      answers: agg.total,
      answeredCurrent: q ? (agg.counts[q.id] || { n: 0 }).n : 0,
      results: agg.counts,
      total: QS.length,
      updatedAt: now()
    };
  }

  function requirePin(p) {
    if (String(p.pin || "") !== DEMO_PIN) throw new Error("PIN salah");
  }

  function answer(p) {
    var s = load();
    if (s.session.status !== "open") throw new Error("Sesi belum dibuka untuk jawaban");

    var q = currentQ(s);
    if (!q) throw new Error("Pertanyaan tidak ditemukan");
    if (String(p.qid) !== q.id) throw new Error("Pertanyaan sudah berganti");

    var v = parseInt(p.value, 10);
    if (!isFinite(v) || v < 1) throw new Error("Jawaban tidak valid");
    if (q.type === "choice" && v > q.options.length) throw new Error("Jawaban tidak valid");
    if (q.type === "likert" && v > q.max) throw new Error("Jawaban tidak valid");

    var rid = String(p.rid || "").slice(0, 64);
    if (!rid) throw new Error("Identitas peserta tidak valid");

    var exists = s.answers.some(function (a) {
      return a.rid === rid && a.qid === q.id;
    });
    if (exists) return { ok: true, already: true, demo: true };

    s.answers.push({ rid: rid, qid: q.id, value: v, ts: now() });
    s.session.updatedAt = now();
    save(s);
    return { ok: true, demo: true };
  }

  function host(p) {
    requirePin(p);
    var s = load();
    var op = String(p.op || "");
    var cur = s.session.current;

    if (op === "start") {
      s.session.status = "open";
      s.session.current = 0;
      s.session.revealed = false;
      s.session.startedAt = now();
      s.session.round = (s.session.round || 0) + 1;
    } else if (op === "reveal") {
      if (s.session.status === "open") {
        s.session.revealed = true;
        s.session.status = "revealed";
      }
    } else if (op === "hide") {
      if (s.session.status === "revealed") {
        s.session.revealed = false;
        s.session.status = "open";
      }
    } else if (op === "next") {
      if (cur < QS.length - 1) {
        s.session.current = cur + 1;
        s.session.revealed = false;
        s.session.status = "open";
      } else {
        s.session.status = "done";
        s.session.revealed = true;
      }
    } else if (op === "goto" || op === "open") {
      var i = parseInt(p.index, 10);
      if (!isFinite(i) || i < 0 || i >= QS.length) throw new Error("Pertanyaan tidak valid");
      s.session.current = i;
      if (op === "open") {
        s.session.revealed = false;
        s.session.status = "open";
      } else {
        s.session.revealed = true;
        s.session.status = "revealed";
      }
    } else if (op === "finish") {
      s.session.status = "done";
      s.session.revealed = true;
    } else if (op === "reset") {
      var round = s.session.round || 0;
      s.session = {
        status: "idle", current: 0, revealed: false,
        round: round, startedAt: null, updatedAt: now()
      };
      if (String(p.clear) === "1") s.answers = [];
    } else {
      throw new Error("Perintah host tidak dikenal");
    }

    s.session.updatedAt = now();
    save(s);
    return hostState(s);
  }

  function call(action, p) {
    p = p || {};
    var s;
    if (action === "state") {
      return publicState(load(), p.rid);
    }
    if (action === "hostState") {
      requirePin(p);
      s = load();
      simulate(s);
      return hostState(s);
    }
    if (action === "answer") return answer(p);
    if (action === "host") return host(p);
    if (action === "ping") return { ok: true, demo: true, now: now() };
    throw new Error("Aksi demo tidak dikenal");
  }

  global.DEMO_BACKEND = {
    call: call,
    reset: resetStorage,
    pin: DEMO_PIN
  };
})(window);
