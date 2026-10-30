/* ============================================================================
   APP — orkestrasi data → DOM → animasi
   ========================================================================== */
(function (global) {
  "use strict";

  var CFG = global.APP_CONFIG || {};
  var FMT = global.FMT;
  var API = global.DATA_API;
  var CH = global.CHARTS;
  var gsap = global.gsap;
  var REDUCED = CH ? CH.reduced : false;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var state = {
    raw: null,
    rows: [],
    schema: null,
    range: 30,
    lastVersion: null,
    firstPaint: true,
    seen: new Set(),
    kpis: {},
    updatedAt: null,
    status: "init"
  };

  var charts = {};

  /* ------------------------------------------------------------- SCHEMA --- */
  function distinctCount(rows, i) {
    var seen = Object.create(null), n = 0;
    for (var r = 0; r < rows.length; r++) {
      var v = rows[r][i];
      if (v === "" || v === null || v === undefined) continue;
      var k = String(v);
      if (!seen[k]) { seen[k] = 1; n++; }
    }
    return n;
  }

  function sampleValues(rows, i, limit) {
    var out = [], max = Math.min(rows.length, limit || 80);
    for (var r = 0; r < max; r++) {
      var v = rows[r][i];
      if (v !== "" && v !== null && v !== undefined) out.push(v);
    }
    return out;
  }

  function guessType(rows, i) {
    var vals = sampleValues(rows, i, 60);
    if (!vals.length) return "string";
    var dates = 0, nums = 0;
    vals.forEach(function (v) {
      if (v instanceof Date) { dates++; return; }
      if (typeof v === "number") { nums++; return; }
      var s = String(v);
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) { dates++; return; }
      if (/^\d+(?:[.,]\d+)?$/.test(s.trim())) nums++;
    });
    if (dates / vals.length > 0.7) return "datetime";
    if (nums / vals.length > 0.7) return "number";
    return "string";
  }

  function matches(name, list) {
    var n = String(name || "").toLowerCase();
    return list.some(function (k) { return n.indexOf(k) !== -1; });
  }

  function pickColumn(cols, cfgName, type, keywords, predicate) {
    if (cfgName) {
      var exact = cols.filter(function (c) { return c.name === cfgName; })[0];
      if (exact) return exact;
    }
    var pool = cols.filter(function (c) { return c.type === type; });
    var kw = pool.filter(function (c) { return matches(c.name, keywords || []); });
    var list = kw.length ? kw : pool;
    for (var i = 0; i < list.length; i++) {
      if (predicate ? predicate(list[i]) : true) return list[i];
    }
    return null;
  }

  function resolveSchema(raw) {
    var cfg = CFG.COLUMNS || {};
    var KW = CFG.KEYWORDS || {};
    var cols = raw.columns.map(function (name, i) {
      return {
        name: name,
        i: i,
        type: (raw.types && raw.types[i]) || guessType(raw.rows, i),
        distinct: distinctCount(raw.rows, i)
      };
    });
    cols.forEach(function (c) {
      var vals = sampleValues(raw.rows, c.i, 120);
      c.avgLen = vals.length ? vals.reduce(function (a, v) { return a + String(v).length; }, 0) / vals.length : 0;
    });

    var date = pickColumn(cols, cfg.date, "datetime", KW.date);
    var name = pickColumn(cols, cfg.name, "string", KW.name);

    var numericCols = cols.filter(function (c) { return c.type === "number" && c.distinct > 1; });
    var rating = null;
    var ratingCfg = cfg.rating ? cols.filter(function (c) { return c.name === cfg.rating; })[0] : null;
    if (ratingCfg && ratingCfg.type === "number") rating = ratingCfg;
    if (!rating) {
      rating = numericCols.filter(function (c) {
        return matches(c.name, KW.rating || []) && c.distinct >= 2 && c.distinct <= 11;
      })[0] || null;
    }
    if (!rating) {
      rating = numericCols.filter(function (c) {
        return c.distinct >= 2 && c.distinct <= 11 && c.name !== (date && date.name);
      })[0] || null;
    }

    function usableString(c) {
      return c.type === "string" &&
        c.distinct >= 2 && c.distinct <= 24 &&
        c.avgLen <= 42 &&
        (!raw.rows.length || c.distinct / raw.rows.length < 0.75) &&
        !(name && c.name === name.name);
    }

    var catCfg = cfg.category ? cols.filter(function (c) { return c.name === cfg.category; })[0] : null;
    var category = (catCfg && usableString(catCfg)) ? catCfg : null;
    if (!category) {
      category = cols.filter(function (c) { return usableString(c) && matches(c.name, KW.category || []); })[0] || null;
    }
    if (!category) category = cols.filter(usableString)[0] || null;

    var regCfg = cfg.region ? cols.filter(function (c) { return c.name === cfg.region; })[0] : null;
    var region = (regCfg && usableString(regCfg) && (!category || regCfg.name !== category.name)) ? regCfg : null;
    if (!region) {
      region = cols.filter(function (c) {
        return usableString(c) && matches(c.name, KW.region || []) && (!category || c.name !== category.name);
      })[0] || null;
    }
    if (!region) {
      region = cols.filter(function (c) {
        return usableString(c) && (!category || c.name !== category.name);
      })[0] || null;
    }

    return {
      all: cols,
      date: date,
      name: name,
      rating: rating,
      category: category,
      region: region
    };
  }

  /* --------------------------------------------------------------- ROWS --- */
  function buildRows(raw, schema) {
    return raw.rows.map(function (arr) {
      var o = { __raw: arr, __d: null, __rating: null };
      if (schema.date) o.__d = FMT.toDate(arr[schema.date.i]);
      if (schema.rating) {
        var rv = arr[schema.rating.i];
        if (FMT.isNum(rv)) o.__rating = FMT.toNum(rv);
      }
      o.__key = (o.__d ? o.__d.getTime() : 0) + "|" +
        (schema.name ? String(arr[schema.name.i] || "") : "") + "|" +
        (schema.category ? String(arr[schema.category.i] || "") : "");
      return o;
    }).filter(function (o) {
      return o.__raw.some(function (v) { return v !== "" && v !== null && v !== undefined; });
    });
  }

  /* --------------------------------------------------------------- KPIs --- */
  function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
  }

  function pctDelta(cur, prev) {
    if (!prev) return null;
    return ((cur - prev) / prev) * 100;
  }

  function kpiDefs() {
    var s = state.schema;
    var rows = state.rows;
    var today = FMT.startOfDay(new Date());
    var d7from = FMT.addDays(today, -6);
    var p7from = FMT.addDays(today, -13);

    var dated = rows.filter(function (r) { return r.__d; });
    var cur7 = dated.filter(function (r) { return r.__d >= d7from; }).length;
    var prev7 = dated.filter(function (r) { return r.__d >= p7from && r.__d < d7from; }).length;
    var delta7 = pctDelta(cur7, prev7);

    var sparkDays = [];
    for (var i = 13; i >= 0; i--) sparkDays.push(0);
    dated.forEach(function (r) {
      var diff = FMT.daysBetween(r.__d, today);
      if (diff >= 0 && diff < 14) sparkDays[13 - diff]++;
    });

    var defs = [
      {
        id: "total",
        label: "Total respons",
        value: rows.length,
        decimals: 0,
        accent: true,
        foot: delta7 === null ? "seluruh periode" : "dibanding 7 hari sebelumnya",
        deltaKind: delta7 === null ? "" : (delta7 >= 0 ? "up" : "down"),
        deltaText: delta7 === null ? "" : (delta7 >= 0 ? "▲" : "▼") + " " + Math.abs(Math.round(delta7)) + "%",
        spark: sparkDays
      },
      {
        id: "week",
        label: "7 hari terakhir",
        value: cur7,
        decimals: 0,
        unit: "respons",
        foot: prev7 ? "periode sebelumnya " + FMT.num(prev7) : "belum ada pembanding",
        deltaKind: ""
      }
    ];

    if (s.rating) {
      var ratedAll = rows.filter(function (r) { return r.__rating !== null; });
      var avg = mean(ratedAll.map(function (r) { return r.__rating; }));
      defs.push({
        id: "rating",
        label: "Rata-rata " + s.rating.name,
        value: avg,
        decimals: 1,
        unit: "/ " + FMT.num(Math.max.apply(null, ratedAll.length ? ratedAll.map(function (r) { return r.__rating; }) : [5])),
        foot: FMT.num(ratedAll.length) + " penilaian",
        deltaKind: "",
        deltaText: ""
      });
    } else {
      var uniqueNames = s.name ? distinctCount(state.raw.rows, s.name.i) : 0;
      defs.push({
        id: "unique",
        label: s.name ? "Responden unik" : "Kolom terisi",
        value: uniqueNames || rows.length,
        decimals: 0,
        unit: s.name ? "orang" : "baris",
        foot: s.name ? s.name.name : "semua kolom",
        deltaKind: "",
        deltaText: ""
      });
    }

    var top = topCategory(rows, s);
    defs.push({
      id: "top",
      label: s.category ? "Kategori teratas" : "Hari terpadat",
      value: top ? top.value : 0,
      decimals: 0,
      unit: top ? FMT.pct(top.value, rows.length) : "",
      foot: top ? top.label : "—",
      deltaKind: "",
      deltaText: "",
      small: true
    });

    return defs;
  }

  function topCategory(rows, s) {
    if (!s.category) return null;
    var map = Object.create(null);
    rows.forEach(function (r) {
      var v = r.__raw[s.category.i];
      if (v === "" || v === null || v === undefined) return;
      var k = String(v).trim();
      map[k] = (map[k] || 0) + 1;
    });
    var entries = Object.keys(map).map(function (k) { return { label: k, value: map[k] }; });
    entries.sort(function (a, b) { return b.value - a.value; });
    return entries[0] || null;
  }

  function renderKpis() {
    var host = $("#kpis");
    var defs = kpiDefs();
    var first = !host.childElementCount;

    if (first) {
      clearNode(host);
      defs.forEach(function (d) {
        var card = document.createElement("article");
        card.className = "kpi" + (d.accent ? " kpi--accent" : "");
        card.setAttribute("data-kpi", d.id);
        card.innerHTML =
          '<div class="kpi__label">' + FMT.esc(d.label) + '</div>' +
          '<div class="kpi__value"><span class="kpi__num" data-num>0</span><span class="kpi__unit"></span></div>' +
          '<div class="kpi__foot">' +
          '<span class="kpi__delta" data-delta hidden></span>' +
          '<svg class="kpi__spark" data-spark viewBox="0 0 74 26" aria-hidden="true"><path d=""/></svg>' +
          '</div>' +
          '<div class="kpi__note" data-note></div>';
        host.appendChild(card);
        state.kpis[d.id] = {
          el: card,
          num: card.querySelector("[data-num]"),
          unit: card.querySelector(".kpi__unit"),
          delta: card.querySelector("[data-delta]"),
          note: card.querySelector("[data-note]"),
          spark: card.querySelector("[data-spark] path"),
          sparkBox: card.querySelector("[data-spark]")
        };
      });
      if (gsap && !REDUCED) {
        gsap.from(host.children, { y: 18, opacity: 0, duration: .7, stagger: .07, ease: "power3.out", delay: .35 });
      }
    }

    defs.forEach(function (d) {
      var k = state.kpis[d.id];
      if (!k) return;
      var from = parseFloat(k.num.getAttribute("data-v") || "0");
      var to = d.value || 0;
      k.num.setAttribute("data-v", String(to));
      k.unit.textContent = d.unit || "";
      countTo(k.num, from, to, d.decimals || 0);

      if (d.deltaText) {
        k.delta.hidden = false;
        k.delta.textContent = d.deltaText;
        k.delta.className = "kpi__delta" + (d.deltaKind === "up" ? " kpi__delta--up" : d.deltaKind === "down" ? " kpi__delta--down" : "");
      } else {
        k.delta.hidden = true;
      }

      if (k.note) k.note.textContent = d.foot || "";

      if (k.spark) {
        if (d.spark) {
          k.spark.setAttribute("d", CH.sparkline(d.spark, 74, 26));
          if (first && gsap && !REDUCED) {
            gsap.fromTo(k.spark, { opacity: 0 }, { opacity: 1, duration: .8, delay: .9 });
          }
        } else {
          k.spark.setAttribute("d", "");
          if (k.sparkBox) k.sparkBox.style.display = "none";
        }
      }
    });
  }

  function countTo(node, from, to, decimals) {
    if (!isFinite(from)) from = 0;
    var fmt = function (v) {
      return decimals > 0
        ? new Intl.NumberFormat(CFG.LOCALE || "id-ID", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v)
        : FMT.num(Math.round(v));
    };
    if (!gsap || REDUCED || Math.abs(to - from) < 0.001) {
      node.textContent = fmt(to);
      return;
    }
    var o = { v: from };
    gsap.to(o, {
      v: to,
      duration: Math.min(1.2, .5 + Math.abs(to - from) / 60),
      ease: "power2.out",
      onUpdate: function () { node.textContent = fmt(o.v); }
    });
  }

  /* ------------------------------------------------------------- SERIES --- */
  function dailySeries(days) {
    var rows = state.rows.filter(function (r) { return r.__d; });
    if (!rows.length) return { points: [], total: 0 };

    var today = FMT.startOfDay(new Date());
    var from = days ? FMT.addDays(today, -(days - 1)) : null;
    if (!from) {
      from = FMT.startOfDay(rows[0].__d);
      var oldest = FMT.startOfDay(rows.reduce(function (a, r) { return r.__d < a ? r.__d : a; }, rows[0].__d));
      from = oldest;
    }

    var span = FMT.daysBetween(from, today) + 1;
    var weekly = span > 140;
    var buckets = Object.create(null);
    var order = [];

    if (weekly) {
      var cursor = FMT.startOfDay(from);
      while (cursor <= today) {
        var k = FMT.dayKey(cursor);
        buckets[k] = 0;
        order.push(cursor);
        cursor = FMT.addDays(cursor, 7);
      }
    } else {
      var c2 = FMT.startOfDay(from);
      while (c2 <= today) {
        buckets[FMT.dayKey(c2)] = 0;
        order.push(c2);
        c2 = FMT.addDays(c2, 1);
      }
    }

    var total = 0;
    rows.forEach(function (r) {
      var d = FMT.startOfDay(r.__d);
      if (d < FMT.startOfDay(from)) return;
      if (weekly) {
        var diff = Math.floor(FMT.daysBetween(FMT.startOfDay(from), d) / 7) * 7;
        d = FMT.addDays(FMT.startOfDay(from), diff);
      }
      var key = FMT.dayKey(d);
      if (key in buckets) { buckets[key]++; total++; }
    });

    return {
      points: order.map(function (d) { return { d: d, v: buckets[FMT.dayKey(d)] }; }),
      total: total,
      weekly: weekly
    };
  }

  /* --------------------------------------------------------- COMPOSITION --- */
  function distribution(col, limit) {
    var rows = state.rows;
    if (!col) return [];
    var map = Object.create(null);
    rows.forEach(function (r) {
      var v = r.__raw[col.i];
      if (v === "" || v === null || v === undefined) return;
      var k = String(v).trim();
      if (!k) return;
      map[k] = (map[k] || 0) + 1;
    });
    var entries = Object.keys(map).map(function (k) { return { label: k, value: map[k] }; });
    entries.sort(function (a, b) { return b.value - a.value; });
    return limit ? entries.slice(0, limit) : entries;
  }

  function composition(col) {
    var entries = distribution(col);
    if (!entries.length) return [];

    var palette = CFG.PALETTE || ["#1f3dff", "#ff5b2e", "#1c7a55", "#7a4fd8", "#c99500", "#0f7f92"];
    var top = entries.slice(0, 5);
    var rest = entries.slice(5);
    if (rest.length) {
      top.push({ label: "Lainnya", value: rest.reduce(function (a, e) { return a + e.value; }, 0) });
    }
    return top.map(function (e, i) {
      return { label: e.label, value: e.value, color: palette[i % palette.length] };
    });
  }

  /* ------------------------------------------------------------- RENDER --- */
  function renderAll(opts) {
    opts = opts || {};
    var s = state.schema;

    renderHeader();
    renderKpis();
    renderLine();
    renderStack();
    renderBars();
    renderRecent();
    renderTable();
  }

  function renderHeader() {
    var raw = state.raw;
    $("#metaSheet").textContent = raw.sheet || CFG.SHEET_NAME || "Google Sheets";
    $("#metaRows").textContent = FMT.num(raw.count || state.rows.length);
    $("#sourceLabel").textContent = raw.demo ? "Mode demo" : (raw.sheet || "Google Sheets");
    $("#footSource").textContent = raw.demo
      ? "Mode demo — sambungkan API_URL di config.js untuk data asli."
      : "Sumber: " + (raw.sheet || "Google Sheets") + " · " + FMT.num(raw.count || state.rows.length) + " baris.";
    $("#footMeta").textContent = (CFG.FOOTER_NOTE || "") + " · " + FMT.dateShort(new Date());
  }

  function renderLine() {
    var res = dailySeries(state.range);
    $("#lineSub").textContent = res.weekly
      ? "Agregat mingguan · " + (state.range ? state.range + " hari" : "semua data")
      : (state.range ? state.range + " hari terakhir" : "sejak respons pertama");
    $("#lineTotal").textContent = FMT.num(res.total) + " respons";
    $("#kpiNote").textContent = state.range ? state.range + " hari terakhir" : "seluruh periode";
    charts.line.setData(res.points, { label: "respons" });
  }

  function renderStack() {
    var s = state.schema;
    var segs = composition(s.category);
    $("#stackSub").textContent = s.category ? "Berdasarkan " + s.category.name : "Tidak ada kolom kategori";
    charts.stack.setData(segs);
  }

  function renderBars() {
    var s = state.schema;
    var col = s.region || s.category;
    if (!col) {
      $("#chartBars").innerHTML = '<div class="empty">Butuh minimal satu kolom teks berulang.</div>';
      $("#barsTitle").textContent = "Peringkat";
      $("#barsSub").textContent = "—";
      $("#detailNote").textContent = "—";
      return;
    }
    $("#barsTitle").textContent = "Peringkat " + col.name.toLowerCase();
    $("#barsSub").textContent = "Diurutkan dari yang terbanyak";
    var items = distribution(col, 8);
    charts.bars.setData(items, { hotFirst: true });
    $("#detailNote").textContent = items.length ? items.length + " teratas" : "—";
  }

  function renderRecent() {
    var s = state.schema;
    var host = $("#recent");
    var rows = state.rows.slice();
    if (s.date) {
      rows.sort(function (a, b) { return (b.__d ? b.__d.getTime() : 0) - (a.__d ? a.__d.getTime() : 0); });
    } else {
      rows = rows.reverse();
    }
    var list = rows.slice(0, CFG.RECENT_COUNT || 6);
    clearNode(host);

    if (!list.length) {
      host.innerHTML = '<li class="empty">Belum ada respons.</li>';
      return;
    }

    $("#recentSub").textContent = s.date ? "Terakhir diperbarui " + FMT.relTime(state.updatedAt) : "Data terbaru";

    list.forEach(function (r, idx) {
      var li = document.createElement("li");
      li.className = "recent__row";
      var name = s.name ? String(r.__raw[s.name.i] || "Tanpa nama") : "Respons #" + (state.rows.length - idx);
      var isNew = !state.seen.has(r.__key);

      var tags = [];
      if (s.category) tags.push(String(r.__raw[s.category.i] || ""));
      if (s.region && (!s.category || s.region.name !== s.category.name)) tags.push(String(r.__raw[s.region.i] || ""));
      if (r.__rating !== null) tags.push("★ " + FMT.num(r.__rating));

      li.innerHTML =
        '<span class="recent__name"><strong>' + FMT.esc(name) + "</strong></span>" +
        '<span class="recent__time">' + FMT.esc(r.__d ? FMT.relTime(r.__d) : "") + "</span>" +
        '<span class="recent__meta">' +
        (isNew && !state.firstPaint ? '<span class="recent__tag recent__tag--new">baru</span>' : "") +
        tags.filter(Boolean).map(function (t) { return '<span class="recent__tag">' + FMT.esc(t) + "</span>"; }).join("") +
        "</span>";
      host.appendChild(li);

      if (gsap && !REDUCED) {
        if (isNew && !state.firstPaint && idx === 0) {
          gsap.from(li, { y: -14, opacity: 0, duration: .55, ease: "power3.out" });
          gsap.fromTo(li, { backgroundColor: "rgba(255,91,46,.16)" }, { backgroundColor: "rgba(255,91,46,0)", duration: 1.6, delay: .25 });
        } else if (state.firstPaint) {
          gsap.from(li, { y: 10, opacity: 0, duration: .5, delay: .5 + idx * .04, ease: "power2.out" });
        }
      }
    });
  }

  function renderTable() {
    var s = state.schema;
    var table = $("#dataTable");
    var head = table.querySelector("thead");
    var body = table.querySelector("tbody");
    var cols = state.raw.columns;

    head.innerHTML = "<tr>" + cols.map(function (c) { return "<th>" + FMT.esc(c) + "</th>"; }).join("") + "</tr>";

    var rows = state.rows.slice();
    if (s.date) rows.sort(function (a, b) { return (b.__d ? b.__d.getTime() : 0) - (a.__d ? a.__d.getTime() : 0); });
    else rows.reverse();
    var limit = CFG.TABLE_ROWS || 60;
    var slice = rows.slice(0, limit);

    body.innerHTML = slice.map(function (r) {
      return "<tr>" + state.raw.columns.map(function (c, i) {
        var v = r.__raw[i];
        var type = state.raw.types && state.raw.types[i];
        var isNum = typeof v === "number" || type === "number";
        var text;
        if (v instanceof Date) text = FMT.dateShort(v) + " " + FMT.clock(v);
        else if (type === "datetime" && v) {
          var dt = FMT.toDate(v);
          text = dt ? FMT.dateShort(dt) + " · " + FMT.clock(dt) : String(v);
        } else if (isNum) text = FMT.num(v);
        else text = String(v == null ? "" : v);
        if (text.length > 120) text = text.slice(0, 117) + "…";
        return '<td class="' + (isNum ? "is-num" : "") + '">' + FMT.esc(text) + "</td>";
      }).join("") + "</tr>";
    }).join("");

    $("#tableNote").textContent = FMT.num(slice.length) + " dari " + FMT.num(rows.length) + " baris";
  }

  function clearNode(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  /* ------------------------------------------------------------ PIPELINE --- */
  function applyPayload(payload, opts) {
    opts = opts || {};
    var isFirst = state.firstPaint;

    var schema = resolveSchema(payload);
    var rows = buildRows(payload, schema);

    state.raw = payload;
    state.rows = rows;
    state.schema = schema;
    state.updatedAt = payload.updatedAt ? FMT.toDate(payload.updatedAt) || new Date() : new Date();

    if (!isFirst) {
      // tandai baris baru
      rows.forEach(function (r) { state.seen.add(r.__key); });
    }

    renderAll({ first: isFirst });

    if (isFirst) {
      state.firstPaint = false;
      state.seen = new Set(rows.map(function (r) { return r.__key; }));
      setStatus(API.isMock ? "mock" : "ok");
      animateIntro();
    } else {
      setStatus(API.isMock ? "mock" : "ok");
      pulseCards();
    }
  }

  function animateIntro() {
    if (!gsap || REDUCED) return;
    var tl = gsap.timeline({ defaults: { ease: "power3.out" } });
    tl.from(".hero .reveal", { y: 26, opacity: 0, duration: .9, stagger: .09 }, 0)
      .from(".section .reveal", { y: 18, opacity: 0, duration: .75, stagger: .06 }, .25);
  }

  function pulseCards() {
    if (!gsap || REDUCED) return;
    gsap.fromTo(".kpi--accent", { boxShadow: "0 0 0 0 rgba(31,61,255,0)" },
      { boxShadow: "0 0 0 4px rgba(31,61,255,.12)", duration: .5, yoyo: true, repeat: 1, ease: "power2.inOut" });
  }

  /* -------------------------------------------------------------- STATUS --- */
  function setStatus(kind, detail) {
    state.status = kind;
    var dot = $("#statusDot");
    var text = $("#statusText");
    if (!dot || !text) return;

    if (kind === "error") {
      dot.className = "dot dot--warn";
      text.textContent = "gagal sinkron";
      showBanner("Tidak bisa menghubungi Apps Script. Menampilkan data terakhir.", true);
    } else if (kind === "connecting") {
      dot.className = "dot dot--idle";
      text.textContent = "menghubungkan";
    } else if (kind === "mock") {
      dot.className = "dot";
      text.textContent = "demo aktif";
    } else {
      dot.className = "dot";
      text.textContent = "tersinkron";
      hideBanner();
    }
  }

  function showBanner(msg, isError) {
    var b = $("#banner");
    b.hidden = false;
    b.className = "banner" + (isError ? " banner--error" : "");
    $("#bannerText").textContent = msg;
  }
  function hideBanner() { $("#banner").hidden = true; }

  var tick = function () {
    if (!state.updatedAt) return;
    $("#metaUpdated").textContent = FMT.relTime(state.updatedAt);
  };

  /* ----------------------------------------------------------------- BOOT --- */
  function init() {
    applyStaticText();

    charts.line = new CH.Line($("#chartLine"));
    charts.stack = new CH.Stack($("#chartStack"), $("#stackLegend"));
    charts.bars = new CH.Bars($("#chartBars"));

    bindEvents();
    setInterval(tick, 1000);

    API.load({ force: true })
      .then(function (payload) {
        applyPayload(payload);
      })
      .catch(function (err) {
        setStatus("error");
        showBanner("Gagal memuat data: " + (err && err.message ? err.message : "tidak diketahui") + ". Periksa API_URL / deployment Apps Script.", true);
      })
      .then(function () {
        API.start({
          data: function (payload) { applyPayload(payload); },
          status: function (kind) {
            if (kind === "error") setStatus("error");
          }
        });
      });
  }

  function applyStaticText() {
    if (CFG.TITLE) document.title = CFG.TITLE;
    if (CFG.LEDE) $("#lede").textContent = CFG.LEDE;
    if (CFG.EYEBROW_LIVE) $("#liveLabel").textContent = CFG.EYEBROW_LIVE;
  }

  function bindEvents() {
    $$("#range button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        $$("#range button").forEach(function (b) { b.setAttribute("aria-selected", "false"); });
        btn.setAttribute("aria-selected", "true");
        state.range = parseInt(btn.getAttribute("data-range"), 10) || 0;
        if (state.rows.length) {
          renderLine();
          renderKpis();
          if (gsap && !REDUCED) {
            gsap.fromTo("#chartLine", { opacity: .35 }, { opacity: 1, duration: .5, ease: "power2.out" });
          }
        }
      });
    });

    $("#refreshBtn").addEventListener("click", function () {
      var btn = this;
      btn.classList.add("is-spinning");
      showBanner("Mengambil data terbaru…", false);
      API.refresh().then(function (p) {
        applyPayload(p);
        hideBanner();
      }).catch(function () {
        setStatus("error");
      }).then(function () {
        btn.classList.remove("is-spinning");
      });
    });

    $("#bannerRetry").addEventListener("click", function () {
      location.reload();
    });

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && state.rows.length) {
        API.check().catch(function () { });
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
