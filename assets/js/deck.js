/* ============================================================================
   DECK — data sheet → slide, dengan animasi GSAP
   ----------------------------------------------------------------------------
   Struktur otomatis dari isi sheet:
   - kolom angka 1..N          → satu slide histogram per pertanyaan
   - kolom teks pilihan        → satu slide peringkat
   - slide pertama             → ringkasan
   ========================================================================== */
(function (global) {
  "use strict";

  var CFG = global.APP_CONFIG || {};
  var FMT = global.FMT;
  var API = global.DATA_API;
  var gsap = global.gsap;

  var ROTATE_MS = CFG.ROTATE_MS || 12000;
  var LIKERT_MAX = CFG.LIKERT_MAX || 10;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var mqReduce = global.matchMedia ? global.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduced() { return !!(mqReduce && mqReduce.matches); }
  function canAnimate() { return !!gsap && !reduced(); }

  var state = {
    model: null,
    built: false,
    cur: 0,
    elapsed: 0,
    paused: false,
    sections: [],
    nav: []
  };

  /* ------------------------------------------------------------- ANGKA ----- */
  function fmtInt(v) { return FMT.num(Math.round(v)); }
  function fmtPct(v) { return Math.round(v) + "%"; }
  function fmtMean(v) { return FMT.num(v, 2); }

  /** Tulis angka, berjalan halus dari nilai sebelumnya. */
  function setNum(node, value, opt) {
    if (!node) return;
    opt = opt || {};
    var fmt = opt.fmt || fmtInt;
    var o = node.__num || (node.__num = { v: 0 });
    if (node.__tw) { node.__tw.kill(); node.__tw = null; }

    if (!canAnimate() || opt.instant) {
      o.v = value;
      node.textContent = fmt(value);
      return;
    }
    node.__tw = gsap.to(o, {
      v: value,
      duration: opt.duration == null ? .8 : opt.duration,
      delay: opt.delay || 0,
      ease: "power2.out",
      overwrite: true,
      onUpdate: function () { node.textContent = fmt(o.v); },
      onComplete: function () { o.v = value; node.__tw = null; }
    });
  }

  /** Lebar/tinggi dalam persen, memakai transform-free tween. */
  function sizeTo(el, prop, pct, opt) {
    if (!el) return;
    opt = opt || {};
    if (!canAnimate() || opt.instant) { el.style[prop] = pct + "%"; return; }
    var vars = {
      duration: opt.duration == null ? .9 : opt.duration,
      delay: opt.delay || 0,
      ease: "power3.out",
      overwrite: true
    };
    vars[prop] = pct + "%";
    gsap.to(el, vars);
  }

  /* ------------------------------------------------------------- MODEL ----- */
  function toNumish(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v === "string" && v.length <= 4 && /^-?\d+(?:[.,]\d+)?$/.test(v.trim())) {
      var n = Number(v.trim().replace(",", "."));
      return isFinite(n) ? n : null;
    }
    return null;
  }

  function profile(rows, i) {
    var p = { filled: 0, nums: [], hist: Object.create(null), text: 0, counts: Object.create(null), order: [] };
    for (var r = 0; r < rows.length; r++) {
      var v = rows[r] ? rows[r][i] : null;
      if (v === null || v === undefined) continue;
      if (typeof v === "string") v = v.trim();
      if (v === "") continue;
      p.filled++;

      var n = toNumish(v);
      if (n !== null) {
        p.nums.push(n);
        p.hist[n] = (p.hist[n] || 0) + 1;
      } else {
        p.text++;
        var key = String(v);
        if (!(key in p.counts)) { p.counts[key] = 0; p.order.push(key); }
        p.counts[key]++;
      }
    }
    return p;
  }

  function shortLabel(q) {
    var map = CFG.LABELS || [];
    var low = String(q).toLowerCase();
    for (var i = 0; i < map.length; i++) {
      if (map[i] && map[i].match && low.indexOf(String(map[i].match).toLowerCase()) !== -1) {
        return map[i].label;
      }
    }
    var s = String(q)
      .replace(/^(seberapa|berapa|apakah|bagaimana|menurut anda,?)\s+/i, "")
      .replace(/\?+$/, "")
      .split(/\s+(?:agar|supaya|untuk|dalam|pada|yang|jika|bila)\s+/i)[0]
      .trim();
    if (s.length > 30) s = s.slice(0, 28).replace(/[\s,;:.-]+$/, "") + "…";
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Pertanyaan";
  }

  function findCol(cols, needle) {
    var q = String(needle).toLowerCase();
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].name.toLowerCase().indexOf(q) !== -1) return cols[i];
    }
    return null;
  }

  function isMeta(name) {
    return /^(timestamp|waktu|tanggal|date|time|email|alamat email|responden|id)\b/i.test(name);
  }

  function scaleFrom(col, p) {
    var max = 1;
    for (var i = 0; i < p.nums.length; i++) if (p.nums[i] > max) max = p.nums[i];
    max = Math.max(1, Math.round(max));

    var dist = [];
    for (var k = 1; k <= max; k++) dist.push(p.hist[k] || 0);

    var total = 0, weighted = 0, maxDist = 0;
    dist.forEach(function (c, idx) {
      total += c;
      weighted += c * (idx + 1);
      if (c > maxDist) maxDist = c;
    });

    return {
      kind: "likert",
      col: col,
      q: col.name,
      label: shortLabel(col.name),
      max: max,
      dist: dist,
      total: total,
      mean: total ? weighted / total : 0,
      top2: total ? (dist[max - 1] + (dist[max - 2] || 0)) / total : 0,
      maxDist: maxDist
    };
  }

  function choiceFrom(col, p) {
    var options = p.order.map(function (label) {
      return { label: label, count: p.counts[label] };
    });
    options.sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label, "id"); });

    var total = 0;
    options.forEach(function (o) { total += o.count; });
    options.forEach(function (o) { o.share = total ? o.count / total : 0; });

    return {
      kind: "choice",
      col: col,
      q: col.name,
      label: shortLabel(col.name),
      options: options,
      total: total
    };
  }

  function buildModel(payload) {
    var rows = payload.rows || [];
    var cols = (payload.columns || []).map(function (name, i) { return { name: String(name), i: i }; });
    var likert = [];
    var choice = null;
    var forced = CFG.COLUMNS || {};

    var forcedLikert = (forced.likert || []).map(function (n) { return findCol(cols, n); }).filter(Boolean);

    if (forcedLikert.length) {
      forcedLikert.forEach(function (col) {
        var p = profile(rows, col.i);
        if (p.nums.length) likert.push(scaleFrom(col, p));
      });
      var fc = forced.choice ? findCol(cols, forced.choice) : null;
      if (fc) choice = choiceFrom(fc, profile(rows, fc.i));
    } else {
      cols.forEach(function (col) {
        if (isMeta(col.name)) return;
        var p = profile(rows, col.i);
        if (p.filled < 3) return;

        var distinct = Object.keys(p.hist).length;
        if (p.nums.length / p.filled > .9 && distinct >= 2 && distinct <= LIKERT_MAX) {
          var min = Math.min.apply(null, p.nums);
          var max = Math.max.apply(null, p.nums);
          if (min >= 0 && max <= LIKERT_MAX && max - min >= 1) {
            likert.push(scaleFrom(col, p));
            return;
          }
        }
        if (!choice && p.text / p.filled > .85 && p.order.length >= 2 && p.order.length <= 14) {
          choice = choiceFrom(col, p);
        }
      });
      likert.sort(function (a, b) { return a.col.i - b.col.i; });
    }

    return {
      n: rows.length,
      likert: likert,
      choice: choice,
      sheet: payload.sheet || "",
      updatedAt: payload.updatedAt
    };
  }

  /* --------------------------------------------------------------- KARTU --- */
  function scaleEnds(q) {
    var low = String(q).toLowerCase();
    if (/penting/.test(low)) return { left: "Sangat tidak penting", right: "Sangat penting", cap: "menilai penting atau sangat penting" };
    if (/setuju/.test(low)) return { left: "Sangat tidak setuju", right: "Sangat setuju", cap: "menilai setuju atau sangat setuju" };
    if (/puas/.test(low)) return { left: "Sangat tidak puas", right: "Sangat puas", cap: "menilai puas atau sangat puas" };
    if (/sering/.test(low)) return { left: "Tidak pernah", right: "Selalu", cap: "menilai sering atau selalu" };
    return { left: "Terendah", right: "Tertinggi", cap: "menilai tinggi" };
  }

  function summarySection(m) {
    var sec = document.createElement("section");
    var totalQ = m.likert.length + (m.choice ? 1 : 0);

    var rows = m.likert.map(function (l, i) {
      return '<button type="button" class="sr" data-i="' + (i + 1) + '">' +
        "<i>" + (i + 1) + "</i>" +
        '<span class="sr__label">' + FMT.esc(l.label) +
        '<span class="track"><u></u></span></span>' +
        "<b>0</b></button>";
    }).join("");

    if (m.choice) {
      rows += '<button type="button" class="sr" data-i="' + totalQ + '">' +
        "<i>" + totalQ + "</i>" +
        '<span class="sr__label">Paling rela dikurangi<small></small>' +
        '<span class="track"><u></u></span></span>' +
        "<b>0%</b></button>";
    }

    sec.innerHTML =
      '<div class="meta"><span>Ringkasan</span><span>' + totalQ + " pertanyaan</span></div>" +
      "<h2>" + FMT.esc(CFG.SUMMARY_HEADLINE || "Hasil sementara survei") + "</h2>" +
      '<div class="body">' +
        '<div class="L"><div class="big" data-n>0</div>' +
        '<p class="cap">responden telah mengisi survei ini</p></div>' +
        '<div class="R sum">' + rows + "</div>" +
      "</div>";

    sec.__refs = { n: $("[data-n]", sec), sr: $$(".sr", sec) };
    return sec;
  }

  function likertSection(l, i, m) {
    var sec = document.createElement("section");
    var totalQ = m.likert.length + (m.choice ? 1 : 0);
    var ends = scaleEnds(l.q);

    var cols = "";
    for (var k = 0; k < l.max; k++) {
      cols += '<div class="col"><div class="bw"><div class="bar"><em>0</em></div></div></div>';
    }
    var ax = "";
    for (var a = 1; a <= l.max; a++) ax += "<i>" + a + "</i>";

    sec.innerHTML =
      '<div class="meta"><span>Pertanyaan ' + (i + 1) + " dari " + totalQ + "</span>" +
      "<span>Skala 1 sampai " + l.max + "</span></div>" +
      "<h2>" + FMT.esc(l.q) + "</h2>" +
      '<div class="body">' +
        '<div class="L"><div class="big"><b class="m">0</b><span>/' + l.max + "</span></div>" +
        '<p class="cap"><strong class="t">0%</strong>' + ends.cap + "</p></div>" +
        '<div class="R"><div class="plot">' + cols + "</div>" +
        '<div class="ax">' + ax + "</div>" +
        '<div class="ends"><span>' + ends.left + "</span><span>" + ends.right + "</span></div></div>" +
      "</div>";

    sec.__refs = {
      m: $(".m", sec),
      t: $(".t", sec),
      cols: $$(".col", sec),
      bars: $$(".bar", sec),
      ems: $$(".bar em", sec)
    };
    return sec;
  }

  function choiceSection(c, idx, total) {
    var sec = document.createElement("section");

    var opts = c.options.map(function (o) {
      return '<div class="opt"><div class="oh"><span>' + FMT.esc(o.label) + "</span>" +
        '<b><span class="pv">0%</span><i><span class="cv">0</span> suara</i></b></div>' +
        '<div class="track"><u></u></div></div>';
    }).join("");

    sec.innerHTML =
      '<div class="meta"><span>Pertanyaan ' + idx + " dari " + total + "</span><span>Pilih satu</span></div>" +
      "<h2>" + FMT.esc(c.q) + "</h2>" +
      '<div class="body">' +
        '<div class="L"><div class="big"><b class="pvbig">0</b><span>%</span></div>' +
        '<p class="cap"><strong class="lead">—</strong><span class="sub"></span></p></div>' +
        '<div class="R opts">' + opts + "</div>" +
      "</div>";

    var refs = {
      big: $(".pvbig", sec),
      lead: $(".lead", sec),
      sub: $(".sub", sec),
      opts: $$(".opt", sec)
    };
    refs.opts.forEach(function (el, i) { el.__label = c.options[i].label; });
    sec.__refs = refs;
    return sec;
  }

  /* --------------------------------------------------------------- PAINT --- */
  function paintSummary(sec, m, mode) {
    var r = sec.__refs;
    var instant = mode === "instant";
    var replay = mode === "replay" && canAnimate();

    if (replay) {
      r.n.__num = { v: 0 };
      r.n.textContent = "0";
      r.sr.forEach(function (row) {
        var u = row.querySelector("u");
        if (u) gsap.set(u, { width: "0%" });
        var b = row.querySelector("b");
        if (b) { b.__num = { v: 0 }; b.textContent = "0"; }
      });
      gsap.fromTo(r.sr, { opacity: 0 }, { opacity: 1, duration: .45, stagger: .05, ease: "power2.out", overwrite: true });
    }

    var delay = replay ? .05 : 0;
    setNum(r.n, m.n, { instant: instant, duration: 1.1 });

    m.likert.forEach(function (l, i) {
      var row = r.sr[i];
      if (!row) return;
      var d = delay + i * .06;
      setNum(row.querySelector("b"), l.mean, { instant: instant, fmt: fmtMean, duration: .9, delay: d });
      sizeTo(row.querySelector("u"), "width", Math.max(1, (l.mean / l.max) * 100), { instant: instant, duration: .9, delay: d });
    });

    if (m.choice) {
      var rowC = r.sr[m.likert.length];
      var lead = m.choice.options[0];
      if (rowC && lead) {
        var dc = delay + m.likert.length * .06;
        setNum(rowC.querySelector("b"), lead.share * 100, { instant: instant, fmt: fmtPct, duration: .9, delay: dc });
        sizeTo(rowC.querySelector("u"), "width", lead.share * 100, { instant: instant, duration: .9, delay: dc });
        var small = rowC.querySelector("small");
        if (small) small.textContent = lead.label;
      }
    }
  }

  function paintLikert(sec, l, mode) {
    var r = sec.__refs;
    var instant = mode === "instant";
    var replay = mode === "replay" && canAnimate();

    if (replay) {
      if (r.m.__tw) { r.m.__tw.kill(); r.m.__tw = null; }
      r.m.__num = { v: 0 }; r.m.textContent = "0";
      if (r.t.__tw) { r.t.__tw.kill(); r.t.__tw = null; }
      r.t.__num = { v: 0 }; r.t.textContent = "0%";
      r.ems.forEach(function (e) {
        if (e.__tw) { e.__tw.kill(); e.__tw = null; }
        e.__num = { v: 0 }; e.textContent = "0";
      });
      r.bars.forEach(function (b) { gsap.set(b, { height: "0%" }); });
    }

    setNum(r.m, l.mean, { instant: instant, fmt: fmtMean, duration: 1, delay: replay ? .04 : 0 });
    setNum(r.t, l.top2 * 100, { instant: instant, fmt: fmtPct, duration: 1, delay: replay ? .1 : 0 });

    r.cols.forEach(function (col, k) {
      var v = l.dist[k] || 0;
      var pct = l.maxDist ? (v / l.maxDist) * 100 : 0;
      col.classList.toggle("mode", v === l.maxDist && v > 0);
      var d = replay ? .08 + k * .05 : 0;
      sizeTo(col.querySelector(".bar"), "height", pct, { instant: instant, duration: .95, delay: d });
      setNum(col.querySelector("em"), v, { instant: instant, duration: .95, delay: d });
    });
  }

  function findByLabel(list, label) {
    for (var i = 0; i < list.length; i++) if (list[i].__label === label) return list[i];
    return null;
  }

  function paintChoice(sec, c, mode) {
    var r = sec.__refs;
    var instant = mode === "instant";
    var replay = mode === "replay" && canAnimate();
    var lead = c.options[0];

    if (replay) {
      r.big.__num = { v: 0 }; r.big.textContent = "0";
      r.opts.forEach(function (el) {
        var u = el.querySelector("u");
        if (u) gsap.set(u, { width: "0%" });
        var pv = el.querySelector(".pv");
        var cv = el.querySelector(".cv");
        if (pv) { pv.__num = { v: 0 }; pv.textContent = "0%"; }
        if (cv) { cv.__num = { v: 0 }; cv.textContent = "0"; }
      });
    }

    setNum(r.big, lead.share * 100, { instant: instant, fmt: fmtInt, duration: 1 });
    r.lead.textContent = lead.label;
    r.sub.textContent = lead.count + " dari " + c.total + " responden";

    /* FLIP saat urutan peringkat berubah karena data baru */
    var flip = !instant && !replay && canAnimate();
    var before = null;
    if (flip) before = r.opts.map(function (el) { return el.getBoundingClientRect().top; });

    c.options.forEach(function (o, rank) {
      var el = findByLabel(r.opts, o.label);
      if (!el) return;
      el.style.order = rank;
      el.classList.toggle("lead", rank === 0);
      el.classList.toggle("rank-1", rank === 0);
      setNum(el.querySelector(".pv"), o.share * 100, { instant: instant, fmt: fmtPct, duration: .8 });
      setNum(el.querySelector(".cv"), o.count, { instant: instant, duration: .8 });
      sizeTo(el.querySelector("u"), "width", o.share * 100, { instant: instant, duration: .8 });
    });

    if (flip && before) {
      var deltas = r.opts.map(function (el, i) { return before[i] - el.getBoundingClientRect().top; });
      r.opts.forEach(function (el, i) {
        if (Math.abs(deltas[i]) > 1) {
          gsap.fromTo(el, { y: deltas[i] }, { y: 0, duration: .6, ease: "power3.out", overwrite: true });
        }
      });
    }
  }

  function paintSection(i, mode) {
    var m = state.model;
    if (!m) return;
    if (i === 0) return paintSummary(state.sections[0], m, mode);
    if (i <= m.likert.length) return paintLikert(state.sections[i], m.likert[i - 1], mode);
    if (m.choice) return paintChoice(state.sections[i], m.choice, mode);
  }

  /* ---------------------------------------------------------------- BUILD -- */
  function buildDeck() {
    var m = state.model;
    var stage = $("#stage");
    var nav = $("#nav");

    stage.innerHTML = "";
    nav.innerHTML = "";

    var names = ["Ringkasan"].concat(m.likert.map(function (l) { return l.label; }));
    if (m.choice) names.push(m.choice.label);

    names.forEach(function (name, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ri" + (i === 0 ? " on" : "");
      b.setAttribute("data-i", i);
      b.innerHTML = "<i>" + (i ? i : "") + "</i><span>" + FMT.esc(name) + "</span><u></u>";
      nav.appendChild(b);
    });
    state.nav = $$(".ri", nav);

    var secs = [summarySection(m)];
    m.likert.forEach(function (l, i) { secs.push(likertSection(l, i, m)); });
    if (m.choice) {
      secs.push(choiceSection(m.choice, m.likert.length + 1, m.likert.length + 1));
    }
    secs.forEach(function (s) { stage.appendChild(s); });

    state.sections = secs;
    state.built = true;
  }

  function renderAll(mode) {
    var m = state.model;
    if (!m || !state.built) return;

    state.sections.forEach(function (s, i) {
      paintSection(i, i === state.cur ? mode : "instant");
    });

    $("#nCount").textContent = FMT.num(m.n);
    $("#updated").textContent = FMT.clock(new Date());
    $("#src").textContent = sourceLabel(m);
  }

  function sourceLabel(m) {
    if (!API.isMock) return m.sheet || CFG.SOURCE_LABEL || "Google Sheets";
    if (API.isSnapshot) return "Data asli · mode pratinjau";
    return "Data contoh";
  }

  /* ----------------------------------------------------------------- SHOW -- */
  function show(i) {
    if (!state.built || !state.sections.length) return;

    var total = state.sections.length;
    i = ((i % total) + total) % total;

    var prev = state.sections[state.cur];
    var next = state.sections[i];
    state.cur = i;
    state.elapsed = 0;

    state.nav.forEach(function (n, k) {
      n.classList.toggle("on", k === i);
      if (k !== i) n.style.setProperty("--p", 0);
    });

    state.sections.forEach(function (s, k) {
      if (k === i) s.classList.add("on");
      else if (s !== prev) s.classList.remove("on");
    });

    if (!canAnimate()) {
      if (prev && prev !== next) prev.classList.remove("on");
      next.classList.add("on");
      paintSection(i, "replay");
      return;
    }

    document.body.classList.add("anim");
    gsap.killTweensOf([prev, next]);

    if (prev && prev !== next) {
      gsap.to(prev, {
        opacity: 0,
        duration: .32,
        ease: "power2.in",
        onComplete: function () {
          prev.classList.remove("on");
          gsap.set(prev, { clearProps: "opacity,transform" });
        }
      });
    }

    gsap.set(next, { opacity: 0 });
    gsap.to(next, {
      opacity: 1,
      duration: .5,
      delay: prev && prev !== next ? .08 : 0,
      ease: "power2.out"
    });

    var items = $$(".meta, h2, .body > *", next);
    gsap.fromTo(items,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: .55, stagger: .07, delay: .12, ease: "power3.out", overwrite: true, clearProps: "opacity,transform" }
    );

    paintSection(i, "replay");
  }

  /* ---------------------------------------------------------------- DATA --- */
  function sameChoice(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.options.length !== b.options.length) return false;
    var ka = a.options.map(function (o) { return o.label; }).sort().join("\u0001");
    var kb = b.options.map(function (o) { return o.label; }).sort().join("\u0001");
    return ka === kb;
  }

  function sameShape(a, b) {
    if (!a || !b) return false;
    if (a.likert.length !== b.likert.length) return false;
    for (var i = 0; i < a.likert.length; i++) if (a.likert[i].max !== b.likert[i].max) return false;
    return sameChoice(a.choice, b.choice);
  }

  function onData(payload) {
    var model = buildModel(payload);
    if (!model.likert.length) return;

    var stable = sameShape(state.model, model);
    state.model = model;

    if (stable) {
      renderAll("soft");
    } else {
      var keep = Math.min(state.cur, 1 + model.likert.length + (model.choice ? 1 : 0) - 1);
      buildDeck();
      state.cur = 0;
      renderAll("instant");
      show(keep);
    }
    hideBanner();
  }

  function loadInitial() {
    return API.load({ force: true }).then(function (payload) {
      var model = buildModel(payload);

      if (!model.likert.length && !model.choice) {
        $("#stage").innerHTML =
          '<section class="on"><div class="empty">Tidak ada kolom skala yang terbaca. ' +
          "Periksa isi sheet atau atur COLUMNS di config.js.</div></section>";
        $("#nCount").textContent = FMT.num(model.n);
        return;
      }

      state.model = model;
      state.cur = 0;
      buildDeck();
      renderAll("instant");
      show(0);
      hideBanner();
    }).catch(function (err) {
      showBanner("Gagal memuat data. Periksa API_URL di config.js, lalu coba lagi.");
      if (!state.built) {
        var stage = $("#stage");
        if (stage) stage.innerHTML = '<div class="boot">Data belum bisa dimuat.<br>Coba lagi beberapa saat.</div>';
      }
      if (global.console) console.error(err);
    });
  }

  /* --------------------------------------------------------------- STATUS -- */
  function showBanner(text) {
    var b = $("#banner"), t = $("#bannerText");
    if (!b || !t) return;
    t.textContent = text;
    b.hidden = false;
  }
  function hideBanner() {
    var b = $("#banner");
    if (b) b.hidden = true;
  }

  function onStatus(kind) {
    if (kind === "error") showBanner("Koneksi terputus — mencoba lagi otomatis.");
    else hideBanner();
  }

  /* ------------------------------------------------------------------ UI --- */
  var lastT = 0;

  function startTicker() {
    function tick(t) {
      if (!lastT) lastT = t;
      var dt = t - lastT;
      lastT = t;
      if (dt > 1500) dt = 0;

      if (!state.paused && !document.hidden) {
        state.elapsed += dt;
        if (state.elapsed >= ROTATE_MS) show(state.cur + 1);
      }

      var active = state.nav[state.cur];
      if (active) active.style.setProperty("--p", Math.min(state.elapsed / ROTATE_MS, 1));
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function setHint() {
    var hint = $("#hint");
    if (hint) hint.textContent = state.paused ? "Dijeda · spasi untuk lanjut" : "Spasi jeda · ← → pindah";
  }

  function bindUI() {
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-i]") : null;
      if (!btn) return;
      var i = parseInt(btn.getAttribute("data-i"), 10);
      if (!isNaN(i)) show(i);
    });

    document.addEventListener("keydown", function (e) {
      if (e.code === "Space") {
        e.preventDefault();
        state.paused = !state.paused;
        setHint();
      } else if (e.key === "ArrowRight") {
        show(state.cur + 1);
      } else if (e.key === "ArrowLeft") {
        show(state.cur - 1);
      }
    });

    var retry = $("#bannerRetry");
    if (retry) retry.addEventListener("click", function () { loadInitial(); });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) API.check().catch(function () {});
    });
  }

  /* ----------------------------------------------------------------- BOOT -- */
  function boot() {
    var brand = $("#brandName");
    var sub = $("#brandSub");
    if (CFG.DISPLAY_SCALE && CFG.DISPLAY_SCALE !== 1) {
      document.documentElement.style.setProperty("--scale", String(CFG.DISPLAY_SCALE));
    }
    if (brand && CFG.TITLE) brand.textContent = CFG.TITLE;
    if (sub && CFG.SUBTITLE) sub.textContent = CFG.SUBTITLE;

    if (canAnimate()) document.body.classList.add("anim");

    bindUI();
    startTicker();
    loadInitial();

    API.start({ data: onData, status: onStatus });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
