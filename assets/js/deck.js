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
      /* nilai yang paling banyak dipilih → yang kedua → dst. */
      ranked: dist.map(function (c, idx) { return { v: idx + 1, c: c }; })
        .sort(function (a, b) { return b.c - a.c || b.v - a.v; }),
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

  /* Kategori skor Likert tidak ditampilkan; slide memakai sebaran jawaban. */

  /* ------------------------------------------------------------- DONAT ---- */
  /* Enam tingkat biru: 0 = nilai tertinggi (biru utama) → 5 = paling pudar. */
  var TONES = ["#0A35F5", "#3F5FF6", "#7C91F8", "#A9B7FA", "#CBD3FC", "#E5E9FD"];

  function toneFor(idx, n) {
    if (n <= 1) return TONES[0];
    var k = Math.round((idx * (TONES.length - 1)) / (n - 1));
    return TONES[Math.max(0, Math.min(TONES.length - 1, k))];
  }

  function polar(cx, cy, r, deg) {
    var a = (deg * Math.PI) / 180;
    /* 0° = pukul 12, bertambah berlawanan arah jarum jam (seperti contoh). */
    return { x: cx - r * Math.sin(a), y: cy - r * Math.cos(a) };
  }

  function arcPath(cx, cy, r, a0, a1) {
    if (a1 - a0 >= 359.9) a1 = a0 + 359.9;
    var p0 = polar(cx, cy, r, a0);
    var p1 = polar(cx, cy, r, a1);
    var large = a1 - a0 > 180 ? 1 : 0;
    return "M" + p0.x.toFixed(2) + " " + p0.y.toFixed(2) +
      "A" + r + " " + r + " 0 " + large + " 0 " + p1.x.toFixed(2) + " " + p1.y.toFixed(2);
  }

  function donutSvg(n) {
    var segs = "";
    for (var i = 0; i < n; i++) segs += '<path class="dg" d=""></path>';
    return '<svg class="c2__s" viewBox="0 0 100 100" aria-hidden="true">' + segs + "</svg>";
  }

  /* progress 0..1 = cincin tumbuh searah jarum jam dari pukul 12. */
  function paintDonut(svg, values, progress) {
    if (!svg || !values) return;
    var total = 0;
    for (var i = 0; i < values.length; i++) total += values[i];
    var paths = svg.querySelectorAll(".dg");
    var n = values.length;
    var acc = 0;
    var visible = 360 * progress;

    for (var j = 0; j < paths.length; j++) {
      var span = total ? (values[j] / total) * 360 : 0;
      var start = acc;
      acc += span;

      var p = paths[j];
      var drawn = Math.max(0, Math.min(span, visible - start));
      if (drawn <= 0.05) { p.setAttribute("d", ""); continue; }

      var a0 = start;
      var a1 = start + drawn;
      if (drawn > 2.6) { a0 += 1.3; a1 -= 1.3; }
      p.setAttribute("d", arcPath(50, 50, 42, a0, a1));
      p.setAttribute("stroke", toneFor(j, n));
    }
  }

  function summaryCard(o) {
    var rows = "";
    o.rows.forEach(function (row, idx) {
      var top = o.cols && idx < o.cols;
      rows += '<span class="lg' + (top ? " lg--top" : "") + '">' +
        '<u style="background:' + toneFor(idx, o.rows.length) + '"></u>' +
        '<span class="lg__l">' + FMT.esc(row.label) + "</span>" +
        '<b class="lg__p">0%</b></span>';
    });

    return '<button type="button" class="c2' + (o.wide ? " c2--wide" : "") + '" data-i="' + o.i + '">' +
      '<span class="c2__h"><span class="c2__n">' + FMT.esc(o.name) + "<b>.</b></span></span>" +
      '<span class="c2__b">' +
        '<span class="c2__d">' + donutSvg(o.rows.length) +
          '<span class="c2__m"><b class="c2__t">0</b><i>Total</i></span></span>' +
        '<span class="c2__l"' + (o.legStyle ? ' style="' + o.legStyle + '"' : "") + ">" + rows + "</span>" +
      "</span>" +
      '<span class="c2__f"><b class="c2__c">0</b><span class="c2__u">Dosen</span>' +
        '<span class="c2__y">memilih <b>—</b></span></span>' +
      "</button>";
  }

  function summarySection(m) {
    var sec = document.createElement("section");
    var totalQ = m.likert.length + (m.choice ? 1 : 0);

    var cards = m.likert.map(function (l, i) {
      var ends = scaleEnds(l.q);
      var rows = [];
      for (var k = l.max; k >= 1; k--) {
        var lab = "Angka " + k;
        if (k === l.max) lab += " (" + ends.right + ")";
        else if (k === 1) lab += " (" + ends.left + ")";
        rows.push({ label: lab });
      }
      return summaryCard({ i: i + 1, name: l.label, rows: rows });
    }).join("");

    /* Pertanyaan pilihan (ke-7): label = teks opsi, dua kolom. */
    if (m.choice) {
      var opts = m.choice.options.slice(0, 8);
      var rows = opts.map(function (o) { return { label: o.label }; });
      var colRows = Math.ceil(rows.length / 2);
      cards += summaryCard({
        i: totalQ,
        name: m.choice.label,
        rows: rows,
        wide: true,
        cols: 2,
        legStyle: "grid-template-rows:repeat(" + colRows + ",auto)"
      });
    }

    sec.innerHTML =
      '<div class="meta"><span>Ringkasan</span><span>' + totalQ + " pertanyaan · " + m.n + " responden</span></div>" +
      "<h2>" + FMT.esc(CFG.SUMMARY_HEADLINE || "Hasil sementara survei") + "</h2>" +
      '<div class="cards">' + cards + "</div>";

    sec.__refs = {
      cards: $$(".c2", sec).map(function (el) {
        return {
          el: el,
          svg: $(".c2__s", el),
          t: $(".c2__t", el),
          c: $(".c2__c", el),
          foot: $(".c2__y b", el),
          pcts: $$(".lg__p", el),
          values: [],
          tw: null
        };
      })
    };
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
      "<span>" + m.n + " responden · skala 1–" + l.max + "</span></div>" +
      "<h2>" + FMT.esc(l.q) + "</h2>" +
      '<div class="body">' +
        '<div class="L">' +
          '<div class="big"><b class="fr">0</b><span class="of"> dari ' + m.n + "</span></div>" +
          '<p class="cap cap--wide"><span class="cl">dosen memilih angka —</span></p>' +
          '<div class="split">' +
            '<p><b class="sp">0%</b><span class="sl">dosen menilai —</span><i class="sn">0 dari ' + m.n + "</i></p>" +
            '<p><b class="sp">0%</b><span class="sl">dosen menilai —</span><i class="sn">0 dari ' + m.n + "</i></p>" +
          "</div>" +
        "</div>" +
        '<div class="R"><div class="plot">' + cols + "</div>" +
        '<div class="ax">' + ax + "</div>" +
        '<div class="ends"><span>1 = ' + ends.left + "</span><span>" + l.max + " = " + ends.right + "</span></div></div>" +
      "</div>";

    sec.__ends = ends;
    sec.__refs = {
      fr: $(".fr", sec),
      of: $(".of", sec),
      cl: $(".cl", sec),
      sp: $$(".split .sp", sec),
      sl: $$(".split .sl", sec),
      sn: $$(".split .sn", sec),
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
        '<p class="cap"><strong class="lead"><span class="lw">memilih</span> <span class="lv">—</span></strong><span class="sub"></span></p></div>' +
        '<div class="R opts">' + opts + "</div>" +
      "</div>";

    var refs = {
      big: $(".pvbig", sec),
      lead: $(".lv", sec),
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
      r.cards.forEach(function (c) {
        if (c.tw) { c.tw.kill(); c.tw = null; }
        c.t.__num = { v: 0 }; c.t.textContent = "0";
        c.c.__num = { v: 0 }; c.c.textContent = "0";
        paintDonut(c.svg, c.values, 0);
      });
      gsap.fromTo(r.cards.map(function (c) { return c.el; }),
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: .5, stagger: .05, ease: "power2.out", overwrite: true });
    }

    function sweep(c, values, delay) {
      if (instant || !canAnimate()) { paintDonut(c.svg, values, 1); return; }
      if (c.tw) { c.tw.kill(); c.tw = null; }
      var o = { p: 0 };
      c.tw = gsap.to(o, {
        p: 1, duration: .9, delay: delay, ease: "power2.out",
        onUpdate: function () { paintDonut(c.svg, values, o.p); },
        onComplete: function () { paintDonut(c.svg, values, 1); c.tw = null; }
      });
    }

    m.likert.forEach(function (l, i) {
      var c = r.cards[i];
      if (!c) return;

      var values = [];
      for (var k = l.max; k >= 1; k--) values.push(l.dist[k - 1] || 0);
      c.values = values;

      var top = l.ranked[0] || { v: l.max, c: 0 };
      var ends = scaleEnds(l.q);
      var d = replay ? .05 + i * .04 : 0;

      setNum(c.t, l.total, { instant: instant, duration: .8, delay: d });
      setNum(c.c, top.c, { instant: instant, duration: .9, delay: d });

      c.pcts.forEach(function (p, idx) {
        var count = l.dist[l.max - idx - 1] || 0;
        p.textContent = fmtPct(l.total ? (count / l.total) * 100 : 0);
      });

      var opt = "angka " + top.v;
      if (top.v === l.max) opt += " (" + ends.right + ")";
      else if (top.v === 1) opt += " (" + ends.left + ")";
      c.foot.textContent = opt;

      sweep(c, values, d);
    });

    if (m.choice) {
      var cc = r.cards[m.likert.length];
      if (cc) {
        var opts = m.choice.options.slice(0, 8);
        var values = opts.map(function (o) { return o.count; });
        var lead = opts[0];
        var d2 = replay ? .05 + m.likert.length * .04 : 0;
        cc.values = values;

        setNum(cc.t, m.choice.total, { instant: instant, duration: .8, delay: d2 });
        setNum(cc.c, lead ? lead.count : 0, { instant: instant, duration: .9, delay: d2 });

        cc.pcts.forEach(function (p, idx) {
          var o = opts[idx];
          p.textContent = o ? fmtPct((o.count / (m.choice.total || 1)) * 100) : "0%";
        });
        cc.foot.textContent = lead ? lead.label : "—";

        sweep(cc, values, d2);
      }
    }
  }

  function paintLikert(sec, l, mode) {
    var r = sec.__refs;
    var instant = mode === "instant";
    var replay = mode === "replay" && canAnimate();
    var ends = sec.__ends || scaleEnds(l.q);
    var first = l.ranked[0] || { v: l.max, c: 0 };
    var second = l.ranked[1] || first;

    if (replay) {
      if (r.fr.__tw) { r.fr.__tw.kill(); r.fr.__tw = null; }
      r.fr.__num = { v: 0 }; r.fr.textContent = "0";
      r.sp.forEach(function (el) {
        if (el.__tw) { el.__tw.kill(); el.__tw = null; }
        el.__num = { v: 0 }; el.textContent = "0%";
      });
      r.ems.forEach(function (e) {
        if (e.__tw) { e.__tw.kill(); e.__tw = null; }
        e.__num = { v: 0 }; e.textContent = "0";
      });
      r.bars.forEach(function (b) { gsap.set(b, { height: "0%" }); });
    }

    /* angka besar: jumlah dosen yang memilih nilai terbanyak */
    setNum(r.fr, first.c, { instant: instant, duration: 1, delay: replay ? .04 : 0 });
    if (r.of) r.of.textContent = " dari " + l.total;
    if (r.cl) {
      r.cl.textContent = "dosen memilih angka " + first.v +
        (first.v === l.max ? " (" + ends.right + ")" : "");
    }

    /* rincian dua nilai yang paling banyak dipilih */
    var d = replay ? .12 : 0;
    [first, second].forEach(function (o, i) {
      var pct = l.total ? (o.c / l.total) * 100 : 0;
      setNum(r.sp[i], pct, { instant: instant, fmt: fmtPct, duration: .9, delay: d + i * .06 });
      if (r.sl[i]) r.sl[i].textContent = "dosen menilai " + o.v;
      if (r.sn[i]) r.sn[i].textContent = o.c + " dari " + l.total;
    });

    r.cols.forEach(function (col, k) {
      var v = l.dist[k] || 0;
      var pct = l.maxDist ? (v / l.maxDist) * 100 : 0;
      col.classList.toggle("mode", v === l.maxDist && v > 0);
      var dd = replay ? .08 + k * .05 : 0;
      sizeTo(col.querySelector(".bar"), "height", pct, { instant: instant, duration: .95, delay: dd });
      setNum(col.querySelector("em"), v, { instant: instant, duration: .95, delay: dd });
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
  /* Tautan langsung: index.html#4 membuka slide ke-4. */
  function jumpToHash() {
    var m = /^#(\d+)$/.exec(location.hash || "");
    if (!m) return;
    var i = parseInt(m[1], 10) - 1;
    if (i > 0) show(i);
  }

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
      jumpToHash();
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

    window.addEventListener("hashchange", jumpToHash);

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
