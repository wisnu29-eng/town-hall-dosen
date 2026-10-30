/* ============================================================================
   CHARTS — SVG/HTML buatan sendiri, dianimasikan dengan GSAP
   Prinsip (dari skill chart-animation):
   - pisahkan "skala nilai" dari "interpolasi frame"
   - easing nilai, bukan hanya opacity
   - label nilai selalu ikut bergerak bersama bentuknya
   ========================================================================== */
(function (global) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var FMT = global.FMT;
  var gsap = global.gsap;
  var REDUCED = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function svgEl(name, attrs) {
    var n = document.createElementNS(NS, name);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function tween(obj, vars) {
    if (gsap && !REDUCED) gsap.to(obj, vars);
    else {
      obj.val = vars.val;
      if (vars.onUpdate) vars.onUpdate();
      if (vars.onComplete) vars.onComplete();
    }
  }

  /* ============================================================ LINE CHART == */
  function LineChart(host) {
    this.host = host;
    this.points = [];
    this.label = "respons";
    this._raf = null;
    this.tip = null;
    var self = this;
    if (global.ResizeObserver) {
      this.ro = new ResizeObserver(function () {
        if (self._raf) cancelAnimationFrame(self._raf);
        self._raf = requestAnimationFrame(function () { self.render(true); });
      });
      this.ro.observe(host);
    }
  }

  LineChart.prototype.setData = function (points, opts) {
    opts = opts || {};
    this.points = (points || []).slice();
    this.label = opts.label || "respons";
    this.render(false);
  };

  LineChart.prototype.render = function (instant) {
    var host = this.host;
    var pts = this.points;
    if (!pts.length) {
      clear(host);
      host.innerHTML = '<div class="empty">Belum ada data pada rentang ini.</div>';
      return;
    }
    if (host.firstChild && host.firstChild.classList && host.firstChild.classList.contains("empty")) clear(host);

    var W = Math.max(320, host.clientWidth || 640);
    var H = Math.max(200, host.clientHeight || 300);
    var pad = { t: 16, r: 14, b: 30, l: 46 };
    var iw = W - pad.l - pad.r;
    var ih = H - pad.t - pad.b;

    var t0 = pts[0].d.getTime();
    var t1 = pts[pts.length - 1].d.getTime();
    if (t1 === t0) { t0 -= 43200000; t1 += 43200000; }

    var maxV = 1;
    for (var i = 0; i < pts.length; i++) if (pts[i].v > maxV) maxV = pts[i].v;
    var yMax = FMT.niceMax(maxV * 1.12);

    function xOf(t) { return pad.l + ((t - t0) / (t1 - t0)) * iw; }
    function yOf(v) { return pad.t + ih - (v / yMax) * ih; }

    var coords = pts.map(function (p) {
      return { x: xOf(p.d.getTime()), y: yOf(p.v), d: p.d, v: p.v };
    });

    clear(host);
    var svg = svgEl("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "presentation" });
    var defs = svgEl("defs");
    var gid = "grad_" + Math.random().toString(36).slice(2, 8);
    var grad = svgEl("linearGradient", { id: gid, x1: "0", y1: "0", x2: "0", y2: "1" });
    grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": "#1f3dff", "stop-opacity": ".20" }));
    grad.appendChild(svgEl("stop", { offset: "72%", "stop-color": "#1f3dff", "stop-opacity": ".04" }));
    grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": "#1f3dff", "stop-opacity": "0" }));
    defs.appendChild(grad);

    var clipId = "clip_" + gid;
    var clip = svgEl("clipPath", { id: clipId });
    var clipRect = svgEl("rect", { x: pad.l, y: 0, width: 0, height: H });
    clip.appendChild(clipRect);
    defs.appendChild(clip);
    svg.appendChild(defs);

    /* --- grid + label sumbu Y --- */
    var ticks = 4;
    for (var g = 0; g <= ticks; g++) {
      var val = (yMax / ticks) * g;
      var y = yOf(val);
      svg.appendChild(svgEl("line", {
        x1: pad.l, x2: pad.l + iw, y1: y, y2: y,
        class: "grid-line", "stroke-dasharray": g === 0 ? "0" : "2 5"
      }));
      var lbl = svgEl("text", { x: pad.l - 10, y: y + 3.5, class: "axis-label axis-label--y" });
      lbl.textContent = FMT.compact(val);
      svg.appendChild(lbl);
    }

    /* --- label sumbu X --- */
    var steps = W < 520 ? 3 : 5;
    for (var s = 0; s <= steps; s++) {
      var tt = t0 + ((t1 - t0) / steps) * s;
      var xx = xOf(tt);
      var anchor = s === 0 ? "start" : (s === steps ? "end" : "middle");
      var xl = svgEl("text", { x: xx, y: H - 8, class: "axis-label", "text-anchor": anchor });
      xl.textContent = FMT.dateShort(new Date(tt));
      svg.appendChild(xl);
    }

    /* --- jalur --- */
    var lineD = smoothPath(coords);
    var areaD = lineD + " L" + coords[coords.length - 1].x + "," + (pad.t + ih) + " L" + coords[0].x + "," + (pad.t + ih) + " Z";

    var area = svgEl("path", { d: areaD, class: "area-fill", fill: "url(#" + gid + ")" });
    area.setAttribute("clip-path", "url(#" + clipId + ")");
    svg.appendChild(area);

    var line = svgEl("path", { d: lineD, class: "line-path" });
    svg.appendChild(line);

    /* --- titik puncak --- */
    var peakIdx = 0;
    for (var p = 1; p < coords.length; p++) if (coords[p].v > coords[peakIdx].v) peakIdx = p;
    var peak = coords[peakIdx];
    var halo = svgEl("circle", { cx: peak.x, cy: peak.y, r: 9, fill: "#1f3dff", opacity: "0" });
    var peakDot = svgEl("circle", { cx: peak.x, cy: peak.y, r: 3.4, fill: "#fffefb", stroke: "#1f3dff", "stroke-width": 2, opacity: "0" });
    svg.appendChild(halo);
    svg.appendChild(peakDot);

    /* --- titik interaktif --- */
    var hits = coords.map(function (c, idx) {
      return svgEl("circle", { cx: c.x, cy: c.y, r: 12, class: "dot-hit", "data-i": idx });
    });
    hits.forEach(function (h) { svg.appendChild(h); });

    var guide = svgEl("line", { x1: 0, x2: 0, y1: pad.t, y2: pad.t + ih, class: "focus-guide", opacity: "0" });
    var focus = svgEl("circle", { cx: 0, cy: 0, r: 4.5, class: "focus-dot", opacity: "0" });
    svg.appendChild(guide);
    svg.appendChild(focus);

    host.appendChild(svg);

    /* --- tooltip --- */
    var tip = host.querySelector(".chart-tip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "chart-tip";
      host.appendChild(tip);
    }
    this.tip = tip;

    var self = this;
    hits.forEach(function (h) {
      h.addEventListener("pointerenter", function () {
        var c = coords[+h.getAttribute("data-i")];
        guide.setAttribute("x1", c.x); guide.setAttribute("x2", c.x);
        focus.setAttribute("cx", c.x); focus.setAttribute("cy", c.y);
        guide.setAttribute("opacity", "1"); focus.setAttribute("opacity", "1");
        tip.style.left = c.x + "px";
        tip.style.top = c.y + "px";
        tip.innerHTML = "<b>" + FMT.num(c.v) + " " + FMT.esc(self.label) + "</b><span>" + FMT.dateLong(c.d) + "</span>";
        tip.style.opacity = "1";
      });
    });
    svg.addEventListener("pointerleave", function () {
      guide.setAttribute("opacity", "0");
      focus.setAttribute("opacity", "0");
      tip.style.opacity = "0";
    });

    if (REDUCED || instant || !gsap) {
      clipRect.setAttribute("width", W);
      peakDot.setAttribute("opacity", "1");
      return;
    }

    /* --- animasi masuk --- */
    var len = line.getTotalLength ? line.getTotalLength() : 1000;
    line.style.strokeDasharray = len;
    line.style.strokeDashoffset = len;

    var tl = gsap.timeline({ defaults: { ease: "power2.out" } });
    tl.to(clipRect, { attr: { width: W }, duration: 1.15, ease: "power2.inOut" }, 0)
      .to(line, { strokeDashoffset: 0, duration: 1.25, ease: "power2.inOut" }, 0)
      .from(svg.querySelectorAll(".axis-label"), { opacity: 0, duration: .5, stagger: .015 }, .15)
      .to(peakDot, { opacity: 1, duration: .4 }, 1.05)
      .fromTo(halo, { attr: { r: 3.4 }, opacity: .35 }, { attr: { r: 13 }, opacity: 0, duration: .9, ease: "power1.out" }, 1.05);
  };

  function smoothPath(pts) {
    if (!pts.length) return "";
    if (pts.length === 1) return "M" + pts[0].x + "," + pts[0].y;
    var d = "M" + r1(pts[0].x) + "," + r1(pts[0].y);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[i + 2] || p2;
      var t = 0.18;
      var c1x = p1.x + (p2.x - p0.x) * t;
      var c1y = p1.y + (p2.y - p0.y) * t;
      var c2x = p2.x - (p3.x - p1.x) * t;
      var c2y = p2.y - (p3.y - p1.y) * t;
      d += " C" + r1(c1x) + "," + r1(c1y) + " " + r1(c2x) + "," + r1(c2y) + " " + r1(p2.x) + "," + r1(p2.y);
    }
    return d;
  }
  function r1(n) { return Math.round(n * 10) / 10; }

  /* ============================================================ BARS CHART == */
  function BarsChart(host) {
    this.host = host;
    this.rows = {};
  }

  BarsChart.prototype.setData = function (items, opts) {
    opts = opts || {};
    var max = 1;
    (items || []).forEach(function (it) { if (it.value > max) max = it.value; });

    var host = this.host;
    clear(host);
    var self = this;
    this.rows = {};

    if (!items || !items.length) {
      host.innerHTML = '<div class="empty">Belum ada kategori untuk ditampilkan.</div>';
      return;
    }

    items.forEach(function (it, idx) {
      var row = document.createElement("div");
      row.className = "bar" + (opts.hotFirst && idx === 0 ? " bar--hot" : (idx > 2 ? " bar--muted" : ""));

      var top = document.createElement("div");
      top.className = "bar__top";
      var name = document.createElement("span");
      name.className = "bar__name";
      name.textContent = it.label;
      name.title = it.label;
      var numEl = document.createElement("span");
      numEl.className = "bar__num";
      numEl.textContent = "0";
      top.appendChild(name);
      top.appendChild(numEl);

      var track = document.createElement("div");
      track.className = "bar__track";
      var fill = document.createElement("div");
      fill.className = "bar__fill";
      track.appendChild(fill);

      row.appendChild(top);
      row.appendChild(track);
      host.appendChild(row);

      var target = Math.max(2, (it.value / max) * 100);
      var o = { val: 0 };
      if (gsap && !REDUCED) {
        gsap.to(fill, { width: target + "%", duration: .9, delay: .06 + idx * .06, ease: "power3.out" });
        gsap.to(o, {
          val: it.value, duration: .9, delay: .06 + idx * .06, ease: "power3.out",
          onUpdate: function () { numEl.textContent = FMT.num(Math.round(o.val)); }
        });
      } else {
        fill.style.width = target + "%";
        numEl.textContent = FMT.num(it.value);
      }
      self.rows[it.label] = { node: row, fill: fill, num: numEl, value: it.value };
    });
  };

  /* =========================================================== STACK CHART == */
  function StackChart(host, legendHost) {
    this.host = host;
    this.legendHost = legendHost;
    this.segs = {};
  }

  StackChart.prototype.setData = function (segments, opts) {
    opts = opts || {};
    var self = this;
    var total = 0;
    segments.forEach(function (s) { total += s.value; });

    if (!segments.length || total === 0) {
      this.host.innerHTML = '<div class="empty">Belum ada jawaban.</div>';
      if (this.legendHost) clear(this.legendHost);
      return;
    }

    // Segmen
    var existing = this.host.querySelectorAll(".stack__seg");
    if (!existing.length) clear(this.host);

    segments.forEach(function (s, idx) {
      var seg = self.segs[s.label];
      if (!seg) {
        seg = document.createElement("div");
        seg.className = "stack__seg";
        seg.title = s.label;
        seg.style.background = s.color;
        self.host.appendChild(seg);
        self.segs[s.label] = seg;
      }
      seg.style.background = s.color;
      var w = (s.value / total) * 100;
      if (gsap && !REDUCED) {
        gsap.to(seg, { width: w + "%", duration: .95, delay: idx * .06, ease: "power3.out" });
      } else {
        seg.style.width = w + "%";
      }
    });

    // Legenda
    if (!this.legendHost) return;
    clear(this.legendHost);
    segments.forEach(function (s, idx) {
      var li = document.createElement("li");
      li.className = "legend__row";
      li.innerHTML =
        '<span class="legend__swatch" style="background:' + s.color + '"></span>' +
        '<span class="legend__name">' + FMT.esc(s.label) + '</span>' +
        '<span class="legend__val">' + FMT.num(s.value) + '</span>' +
        '<span class="legend__pct">' + FMT.pct(s.value, total) + '</span>';
      self.legendHost.appendChild(li);
      if (gsap && !REDUCED) gsap.from(li, { opacity: 0, x: -8, duration: .5, delay: idx * .05, ease: "power2.out" });
    });
  };

  /* ============================================================== SPARKLINE == */
  function sparkline(values, width, height) {
    width = width || 74; height = height || 26;
    if (!values.length) return "";
    var max = Math.max.apply(null, values);
    var min = Math.min.apply(null, values);
    var span = max - min || 1;
    var step = values.length > 1 ? width / (values.length - 1) : width;
    var d = "";
    values.forEach(function (v, i) {
      var x = i * step;
      var y = height - 2 - ((v - min) / span) * (height - 4);
      d += (i === 0 ? "M" : "L") + r1(x) + "," + r1(y) + " ";
    });
    return d.trim();
  }

  global.CHARTS = {
    Line: LineChart,
    Bars: BarsChart,
    Stack: StackChart,
    sparkline: sparkline,
    reduced: REDUCED
  };
})(window);
