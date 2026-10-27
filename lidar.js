// LiDAR explainer animation for the "How Sparky sees the room" section.
// A top-down view of a 12 m x 8 m event room: Sparky sends a pulse, times the echo,
// sweeps a full circle into a point cloud, builds a grid map, then plans a path (A*) and walks it.
// Colors come from the CSS variables in styles.css, so it follows light and dark mode.
(function () {
  var canvas = document.getElementById("scan-canvas");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  var section = document.getElementById("scan");
  var toggleBtn = document.getElementById("scan-toggle");
  var restartBtn = document.getElementById("scan-restart");
  var phaseLabel = document.getElementById("scan-phase-label");
  var roDist = document.getElementById("ro-dist");
  var roTime = document.getElementById("ro-time");
  var roPoints = document.getElementById("ro-points");
  var stepBtns = Array.prototype.slice.call(document.querySelectorAll(".step-btn"));
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var FONT = '"Atkinson Hyperlegible", "Helvetica Neue", Arial, sans-serif';

  // Room is 12 m x 8 m, y grows downward like the screen
  var W = 12, H = 8;
  var C = 0.299792458;           // speed of light in meters per nanosecond
  var MAX_R = 15;                // longest range we draw, in meters
  var START = { x: 3.2, y: 5.0 };
  var GOAL = { x: 10.6, y: 4.0 };
  var SPEED = 1.3;               // walking speed in m/s
  var INFL = 0.42;               // how close Sparky's center may get to anything

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---- Room ----
  var segs = [];
  function seg(x1, y1, x2, y2) { segs.push([x1, y1, x2, y2]); }
  seg(0, 0, W, 0); seg(W, 0, W, H); seg(W, H, 6.7, H); seg(5.3, H, 0, H); seg(0, H, 0, 0);
  var WALL_SEGS = segs.length;
  var rects = [
    { x1: 1.0, y1: 0.8, x2: 3.8, y2: 1.6, label: "IT booth" },
    { x1: 6.1, y1: 3.3, x2: 6.6, y2: 3.8, label: "" },
    { x1: 10.9, y1: 0.7, x2: 11.6, y2: 2.7, label: "" }
  ];
  rects.forEach(function (r) {
    seg(r.x1, r.y1, r.x2, r.y1); seg(r.x2, r.y1, r.x2, r.y2);
    seg(r.x2, r.y2, r.x1, r.y2); seg(r.x1, r.y2, r.x1, r.y1);
  });
  var circles = [
    { x: 8.4, y: 2.4, r: 0.65, person: false },
    { x: 9.7, y: 6.1, r: 0.65, person: false },
    { x: 2.0, y: 2.5, r: 0.24, person: true },
    { x: 2.9, y: 2.4, r: 0.24, person: true },
    { x: 7.3, y: 4.3, r: 0.24, person: true },
    { x: 7.5, y: 5.0, r: 0.24, person: true },
    { x: 4.6, y: 6.8, r: 0.24, person: true },
    { x: 10.6, y: 7.1, r: 0.24, person: true }
  ];

  function cast(ox, oy, a) {
    var dx = Math.cos(a), dy = Math.sin(a), best = MAX_R;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i], ex = s[2] - s[0], ey = s[3] - s[1];
      var den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      var px = s[0] - ox, py = s[1] - oy;
      var t = (px * ey - py * ex) / den;
      var u = (px * dy - py * dx) / den;
      if (t > 1e-6 && u >= 0 && u <= 1 && t < best) best = t;
    }
    for (var j = 0; j < circles.length; j++) {
      var c = circles[j], fx = ox - c.x, fy = oy - c.y;
      var b = fx * dx + fy * dy, cc = fx * fx + fy * fy - c.r * c.r, disc = b * b - cc;
      if (disc < 0) continue;
      var t2 = -b - Math.sqrt(disc);
      if (t2 > 1e-6 && t2 < best) best = t2;
    }
    return best;
  }

  function clearance(x, y) {
    var m = Math.min(x, W - x, y, H - y);
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      var dx = Math.max(r.x1 - x, 0, x - r.x2), dy = Math.max(r.y1 - y, 0, y - r.y2);
      m = Math.min(m, Math.hypot(dx, dy));
    }
    for (var j = 0; j < circles.length; j++) {
      var c = circles[j];
      m = Math.min(m, Math.hypot(x - c.x, y - c.y) - c.r);
    }
    return m;
  }

  // ---- The full sweep from the starting spot: two spins, offset by half a step ----
  var RAYS = 900, HALF = RAYS / 2, rand = rng(11), rays = [], hitCount = [0];
  for (var k = 0; k < RAYS; k++) {
    var a = (k % HALF) / HALF * Math.PI * 2 + (k >= HALF ? Math.PI / HALF : 0);
    var d = cast(START.x, START.y, a), hit = d < MAX_R;
    var dn = hit ? d + (rand() - 0.5) * 0.04 : MAX_R;
    rays.push({ a: a, d: d, hit: hit, x: START.x + Math.cos(a) * dn, y: START.y + Math.sin(a) * dn });
    hitCount.push(hitCount[k] + (hit ? 1 : 0));
  }
  var TOTAL_HITS = hitCount[RAYS];

  // The single pulse we follow in steps 1 and 2 (aimed at the lower table)
  var PULSE_A = Math.atan2(6.1 - START.y, 9.7 - START.x);
  var PULSE_D = cast(START.x, START.y, PULSE_A);
  var PULSE_NS = 2 * PULSE_D / C;

  // ---- Grid map ----
  var CELL = 0.25, GX = Math.round(W / CELL), GY = Math.round(H / CELL);
  function cellIndex(x, y) {
    var cx = Math.min(GX - 1, Math.max(0, Math.floor(x / CELL)));
    var cy = Math.min(GY - 1, Math.max(0, Math.floor(y / CELL)));
    return cy * GX + cx;
  }
  var seen = {}, mapCells = [];
  rays.forEach(function (r) {
    if (!r.hit) return;
    var i = cellIndex(r.x, r.y);
    if (seen[i]) return;
    seen[i] = 1;
    var cx = i % GX, cy = (i - cx) / GX;
    mapCells.push({ cx: cx, cy: cy, d: Math.hypot((cx + 0.5) * CELL - START.x, (cy + 0.5) * CELL - START.y) });
  });
  mapCells.sort(function (p, q) { return p.d - q.d; });
  var MAX_CELL_D = mapCells.length ? mapCells[mapCells.length - 1].d : 1;

  // ---- Path planning: A* on the grid, then straighten ----
  var free = new Uint8Array(GX * GY);
  for (var gy = 0; gy < GY; gy++) {
    for (var gx = 0; gx < GX; gx++) {
      free[gy * GX + gx] = clearance((gx + 0.5) * CELL, (gy + 0.5) * CELL) > INFL ? 1 : 0;
    }
  }
  function astar() {
    var s = cellIndex(START.x, START.y), g = cellIndex(GOAL.x, GOAL.y), N = GX * GY;
    var gScore = new Float64Array(N), came = new Int32Array(N), closed = new Uint8Array(N);
    for (var i = 0; i < N; i++) { gScore[i] = Infinity; came[i] = -1; }
    var gxc = g % GX, gyc = (g - gxc) / GX;
    function h(n) {
      var x = n % GX, y = (n - x) / GX, ax = Math.abs(x - gxc), ay = Math.abs(y - gyc);
      return ax + ay + (Math.SQRT2 - 2) * Math.min(ax, ay);
    }
    var open = [s]; gScore[s] = 0;
    while (open.length) {
      var bi = 0, bf = Infinity;
      for (var q = 0; q < open.length; q++) {
        var f = gScore[open[q]] + h(open[q]);
        if (f < bf) { bf = f; bi = q; }
      }
      var cur = open.splice(bi, 1)[0];
      if (cur === g) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      var cx = cur % GX, cy = (cur - cx) / GX;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= GX || ny >= GY) continue;
          var n = ny * GX + nx;
          if (!free[n] || closed[n]) continue;
          if (dx && dy && (!free[cy * GX + nx] || !free[ny * GX + cx])) continue;
          var ng = gScore[cur] + (dx && dy ? Math.SQRT2 : 1);
          if (ng < gScore[n]) { gScore[n] = ng; came[n] = cur; open.push(n); }
        }
      }
    }
    if (came[g] === -1) return null;
    var out = [];
    for (var c = g; c !== -1; c = came[c]) out.push(c);
    return out.reverse();
  }
  function lineIsClear(p, q) {
    var L = Math.hypot(q.x - p.x, q.y - p.y), n = Math.max(1, Math.ceil(L / 0.05));
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      if (clearance(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t) <= INFL * 0.9) return false;
    }
    return true;
  }
  var path = [START, GOAL];
  var cellsPath = astar();
  if (cellsPath && cellsPath.length > 1) {
    var pts = cellsPath.map(function (ci) {
      var cx = ci % GX, cy = (ci - cx) / GX;
      return { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL };
    });
    pts[0] = START; pts[pts.length - 1] = GOAL;
    path = [pts[0]];
    var i0 = 0;
    while (i0 < pts.length - 1) {
      var j0 = pts.length - 1;
      while (j0 > i0 + 1 && !lineIsClear(pts[i0], pts[j0])) j0--;
      path.push(pts[j0]);
      i0 = j0;
    }
  }
  var segLen = [], PATH_LEN = 0;
  for (var p = 1; p < path.length; p++) {
    var L = Math.hypot(path[p].x - path[p - 1].x, path[p].y - path[p - 1].y);
    segLen.push(L); PATH_LEN += L;
  }
  function posAt(dist) {
    var left = Math.max(0, Math.min(dist, PATH_LEN));
    for (var i = 0; i < segLen.length; i++) {
      if (left <= segLen[i] || i === segLen.length - 1) {
        var f = segLen[i] ? Math.min(1, left / segLen[i]) : 1, a = path[i], b = path[i + 1];
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, h: Math.atan2(b.y - a.y, b.x - a.x) };
      }
      left -= segLen[i];
    }
    return { x: START.x, y: START.y, h: 0 };
  }

  // ---- Timeline ----
  var OUT_MS = 1500, SWEEP_MS = 5200, PATH_DRAW = 1200, HOLD = 1800;
  var WALK_MS = PATH_LEN / SPEED * 1000;
  var PHASES = [
    { name: "Send a laser pulse", dur: 4200 },
    { name: "Time the echo", dur: 3800 },
    { name: "Spin to see everything", dur: 5800 },
    { name: "Build a map", dur: 3400 },
    { name: "Plan a path and walk", dur: PATH_DRAW + WALK_MS + HOLD }
  ];

  var phase = 0, t = 0, running = !reduceMotion, inView = !("IntersectionObserver" in window);
  var walk = null;
  function resetWalk() {
    walk = { x: START.x, y: START.y, h: 0, pts: [], total: 0, recent: [], cells: {}, cellList: [], spin: 0, acc: 0, lastRay: null };
  }
  resetWalk();

  function enterPhase(i) {
    phase = i; t = 0;
    resetWalk();
    phaseLabel.textContent = "Step " + (i + 1) + " of 5 · " + PHASES[i].name;
    stepBtns.forEach(function (b, k) {
      if (k === i) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
    });
  }

  function updateWalk(dt) {
    var wt = t - PATH_DRAW;
    if (wt <= 0) return;
    var pos = posAt(wt / 1000 * SPEED);
    var dh = ((pos.h - walk.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    walk.h += dh * Math.min(1, dt / 120);
    walk.x = pos.x; walk.y = pos.y;
    walk.acc += dt * 0.13;
    while (walk.acc >= 1) {
      walk.acc -= 1;
      walk.spin += Math.PI * 2 * 2.03 / 360;
      var a = walk.spin, d = cast(walk.x, walk.y, a), hit = d < MAX_R;
      var ray = { ox: walk.x, oy: walk.y, a: a, d: d, hit: hit, x: walk.x + Math.cos(a) * d, y: walk.y + Math.sin(a) * d };
      walk.recent.push(ray);
      if (walk.recent.length > 14) walk.recent.shift();
      if (hit) {
        walk.pts.push(ray); walk.total++;
        if (walk.pts.length > 2500) walk.pts.shift();
        var ci = cellIndex(ray.x, ray.y);
        if (!seen[ci] && walk.cells[ci] === undefined) { walk.cells[ci] = t; walk.cellList.push(ci); }
      }
      walk.lastRay = ray;
    }
  }

  // ---- Drawing ----
  var s = 40, dpr = 1, cssW = 0, cssH = 0, col = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    function v(n) { return cs.getPropertyValue(n).trim(); }
    col = {
      surface: v("--surface"), ink: v("--ink"), muted: v("--muted"), line: v("--line"), accent: v("--accent"),
      point: v("--scan-point"), cell: v("--scan-cell"), body: v("--robot-body"), limb: v("--robot-limb"),
      edge: v("--robot-edge"), dark: v("--robot-dark"), cable: v("--cable")
    };
  }
  function fontSize() { return Math.max(10, Math.min(13, s * 0.28)); }
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function pill(text, x, y, align) {
    var fs = fontSize();
    ctx.font = "600 " + fs + "px " + FONT;
    var w = ctx.measureText(text).width + 16, h = fs + 10;
    var left = align === "left" ? x : x - w / 2;
    left = Math.max(6, Math.min(cssW - w - 6, left));
    var top = Math.max(6, Math.min(cssH - h - 6, y - h / 2));
    ctx.globalAlpha = 0.95; ctx.fillStyle = col.surface; rr(left, top, w, h, h / 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = col.line; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = col.ink; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(text, left + 8, top + h / 2 + 0.5);
  }
  function dot(x, y, r, color, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawRoom() {
    ctx.lineWidth = 1; ctx.strokeStyle = col.line; ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (var x = 1; x < W; x++) { ctx.moveTo(Math.round(x * s) + 0.5, 0); ctx.lineTo(Math.round(x * s) + 0.5, cssH); }
    for (var y = 1; y < H; y++) { ctx.moveTo(0, Math.round(y * s) + 0.5); ctx.lineTo(cssW, Math.round(y * s) + 0.5); }
    ctx.stroke();

    ctx.strokeStyle = col.muted; ctx.fillStyle = col.muted;
    ctx.globalAlpha = 0.4; ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (var i = 0; i < WALL_SEGS; i++) { var w = segs[i]; ctx.moveTo(w[0] * s, w[1] * s); ctx.lineTo(w[2] * s, w[3] * s); }
    ctx.stroke();
    ctx.lineWidth = 1.25;
    rects.forEach(function (r) {
      ctx.globalAlpha = 0.08; ctx.fillRect(r.x1 * s, r.y1 * s, (r.x2 - r.x1) * s, (r.y2 - r.y1) * s);
      ctx.globalAlpha = 0.35; ctx.strokeRect(r.x1 * s, r.y1 * s, (r.x2 - r.x1) * s, (r.y2 - r.y1) * s);
    });
    circles.forEach(function (c) {
      ctx.beginPath(); ctx.arc(c.x * s, c.y * s, c.r * s, 0, Math.PI * 2);
      ctx.globalAlpha = c.person ? 0.2 : 0.08; ctx.fill();
      ctx.globalAlpha = 0.35; ctx.stroke();
    });

    var fs = fontSize();
    ctx.font = "500 " + fs + "px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.8; ctx.fillStyle = col.muted;
    ctx.fillText("IT booth", (rects[0].x1 + rects[0].x2) / 2 * s, (rects[0].y1 + rects[0].y2) / 2 * s);
    if (phase >= 2) ctx.fillText("Door", 6.0 * s, (H - 0.3) * s);
    ctx.globalAlpha = 1;
  }

  function drawScaleBar() {
    var x2 = cssW - 12, x1 = x2 - s, y = cssH - 12;
    ctx.strokeStyle = col.muted; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(x1, y - 4); ctx.lineTo(x1, y); ctx.lineTo(x2, y); ctx.lineTo(x2, y - 4); ctx.stroke();
    ctx.fillStyle = col.muted; ctx.font = "600 " + Math.max(10, fontSize() - 1) + "px " + FONT;
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText("1 m", (x1 + x2) / 2, y - 5);
    ctx.globalAlpha = 1;
  }

  function drawCells(tt) {
    ctx.fillStyle = col.cell;
    var pad = Math.max(0.5, CELL * s * 0.08), size = CELL * s - pad * 2;
    for (var k = 0; k < mapCells.length; k++) {
      var c = mapCells[k], at = (c.d / MAX_CELL_D) * 2400;
      var a = Math.max(0, Math.min(1, (tt - at) / 350));
      if (a <= 0) continue;
      ctx.globalAlpha = 0.6 * a;
      ctx.fillRect(c.cx * CELL * s + pad, c.cy * CELL * s + pad, size, size);
    }
    if (phase === 4) {
      for (var j = 0; j < walk.cellList.length; j++) {
        var ci = walk.cellList[j], cx = ci % GX, cy = (ci - cx) / GX;
        ctx.globalAlpha = 0.6 * Math.min(1, (t - walk.cells[ci]) / 350);
        ctx.fillRect(cx * CELL * s + pad, cy * CELL * s + pad, size, size);
      }
    }
    ctx.globalAlpha = 1;
  }

  function beam(ox, oy, a, d, alpha) {
    var L = Math.min(d, MAX_R);
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.moveTo(ox * s, oy * s);
    ctx.lineTo((ox + Math.cos(a) * L) * s, (oy + Math.sin(a) * L) * s); ctx.stroke();
  }

  function drawSweep(tt) {
    var n = phase === 2 ? Math.floor(Math.min(1, tt / SWEEP_MS) * RAYS) : RAYS;
    var alpha = phase === 2 ? 0.95 : phase === 3 ? 0.95 - 0.55 * Math.min(1, tt / 1500) : 0.4;
    var ps = Math.max(1.6, s * 0.045);
    ctx.fillStyle = col.point; ctx.globalAlpha = alpha;
    for (var k = 0; k < n; k++) {
      var r = rays[k];
      if (r.hit) ctx.fillRect(r.x * s - ps / 2, r.y * s - ps / 2, ps, ps);
    }
    if (phase === 2 && n < RAYS) {
      ctx.strokeStyle = col.accent; ctx.lineWidth = Math.max(1, s * 0.03);
      for (var b = 0; b < 18; b++) {
        var k2 = n - 1 - b;
        if (k2 < 0) break;
        beam(START.x, START.y, rays[k2].a, rays[k2].d, (1 - b / 18) * 0.9);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawWalkScan() {
    var ps = Math.max(1.6, s * 0.045);
    ctx.fillStyle = col.point; ctx.globalAlpha = 0.9;
    for (var i = 0; i < walk.pts.length; i++) {
      var r = walk.pts[i];
      ctx.fillRect(r.x * s - ps / 2, r.y * s - ps / 2, ps, ps);
    }
    ctx.strokeStyle = col.accent; ctx.lineWidth = Math.max(1, s * 0.03);
    for (var j = 0; j < walk.recent.length; j++) {
      var rr2 = walk.recent[j];
      beam(rr2.ox, rr2.oy, rr2.a, rr2.d, ((j + 1) / walk.recent.length) * 0.85);
    }
    ctx.globalAlpha = 1;
  }

  function drawPath(tt) {
    var frac = Math.min(1, tt / PATH_DRAW), want = frac * PATH_LEN;
    ctx.strokeStyle = col.accent; ctx.lineWidth = Math.max(2, s * 0.06);
    ctx.lineCap = "round"; ctx.setLineDash([s * 0.18, s * 0.12]);
    ctx.beginPath(); ctx.moveTo(path[0].x * s, path[0].y * s);
    var used = 0;
    for (var i = 0; i < segLen.length; i++) {
      var a = path[i], b = path[i + 1];
      if (used + segLen[i] >= want) {
        var f = segLen[i] ? (want - used) / segLen[i] : 1;
        ctx.lineTo((a.x + (b.x - a.x) * f) * s, (a.y + (b.y - a.y) * f) * s);
        break;
      }
      ctx.lineTo(b.x * s, b.y * s);
      used += segLen[i];
    }
    ctx.stroke(); ctx.setLineDash([]);

    var ga = Math.min(1, tt / 400);
    ctx.globalAlpha = ga; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(GOAL.x * s, GOAL.y * s, Math.max(7, 0.22 * s), 0, Math.PI * 2); ctx.stroke();
    dot(GOAL.x * s, GOAL.y * s, Math.max(2.5, 0.07 * s), col.accent, ga);
    ctx.globalAlpha = ga; ctx.fillStyle = col.ink;
    ctx.font = "600 " + fontSize() + "px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText("Goal", GOAL.x * s, GOAL.y * s - Math.max(9, 0.3 * s));
    ctx.globalAlpha = 1;
  }

  function drawPulse(tt) {
    var ox = START.x, oy = START.y, ca = Math.cos(PULSE_A), sa = Math.sin(PULSE_A);
    var hx = ox + ca * PULSE_D, hy = oy + sa * PULSE_D;
    ctx.strokeStyle = col.accent; ctx.lineWidth = Math.max(1.5, s * 0.04);
    if (phase === 0) {
      ctx.globalAlpha = 0.3; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(ox * s, oy * s); ctx.lineTo(hx * s, hy * s); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (tt < 2 * OUT_MS) {
        var goingOut = tt < OUT_MS;
        var f = goingOut ? tt / OUT_MS : 1 - (tt - OUT_MS) / OUT_MS;
        var px = ox + ca * PULSE_D * f, py = oy + sa * PULSE_D * f;
        ctx.beginPath();
        if (goingOut) ctx.moveTo(ox * s, oy * s); else ctx.moveTo(hx * s, hy * s);
        ctx.lineTo(px * s, py * s); ctx.stroke();
        dot(px * s, py * s, Math.max(6, s * 0.16), col.accent, 0.25);
        dot(px * s, py * s, Math.max(3.5, s * 0.09), col.accent, 1);
        pill(goingOut ? "Pulse heading out" : "Echo coming back", 10, cssH - 22, "left");
      } else {
        pill("Echo received", 10, cssH - 22, "left");
      }
      if (tt >= OUT_MS) dot(hx * s, hy * s, Math.max(3, s * 0.08), col.point, 1);
    } else {
      ctx.beginPath(); ctx.moveTo(ox * s, oy * s); ctx.lineTo(hx * s, hy * s); ctx.stroke();
      dot(hx * s, hy * s, Math.max(3.5, s * 0.09), col.point, 1);
      var mx = (ox + hx) / 2, my = (oy + hy) / 2;
      pill(PULSE_D.toFixed(2) + " m away", (mx - sa * 0.45) * s, (my + ca * 0.45) * s, "center");
      pill("Distance = speed of light × " + PULSE_NS.toFixed(1) + " ns ÷ 2", 10, cssH - 22, "left");
    }
  }

  function drawRobot(x, y, h) {
    var k = s * 1.35, L = 0.70 * k, Wd = 0.31 * k;
    ctx.save();
    ctx.translate(x * s, y * s); ctx.rotate(h);
    ctx.fillStyle = col.limb;
    [[0.22, 1], [0.22, -1], [-0.22, 1], [-0.22, -1]].forEach(function (p) {
      var lx = p[0] * k - 0.06 * k, ly = p[1] > 0 ? Wd / 2 - 0.03 * k : -Wd / 2 - 0.08 * k;
      rr(lx, ly, 0.12 * k, 0.11 * k, 0.03 * k); ctx.fill();
    });
    ctx.fillStyle = col.body; ctx.strokeStyle = col.edge; ctx.lineWidth = 1;
    rr(-L / 2, -Wd / 2, L, Wd, 0.1 * k); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col.limb;
    rr(L / 2 - 0.17 * k, -Wd / 2 + 0.035 * k, 0.15 * k, Wd - 0.07 * k, 0.05 * k); ctx.fill();
    ctx.fillStyle = col.dark;
    rr(L / 2 - 0.02 * k, -0.08 * k, 0.05 * k, 0.16 * k, 0.015 * k); ctx.fill();
    ctx.strokeStyle = col.cable; ctx.lineWidth = Math.max(1.5, 0.025 * k); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(0.07 * k, 0.03 * k);
    ctx.bezierCurveTo(0.2 * k, 0.2 * k, 0.3 * k, 0.12 * k, 0.26 * k, 0.02 * k); ctx.stroke();
    ctx.fillStyle = col.dark; ctx.beginPath(); ctx.arc(0, 0, 0.1 * k, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col.accent; ctx.lineWidth = Math.max(1.2, 0.02 * k); ctx.stroke();
    ctx.fillStyle = col.body; ctx.beginPath(); ctx.arc(0, 0, 0.055 * k, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function draw() {
    if (!cssW) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = col.surface; ctx.fillRect(0, 0, cssW, cssH);
    drawRoom();
    if (phase >= 3) drawCells(phase === 3 ? t : Infinity);
    if (phase >= 2) drawSweep(t);
    if (phase === 4) { drawWalkScan(); drawPath(t); }
    if (phase <= 1) drawPulse(t);
    if (phase === 4) drawRobot(walk.x, walk.y, walk.h); else drawRobot(START.x, START.y, 0);
    drawScaleBar();
  }

  // ---- Readout under the canvas ----
  function fmtM(d) { return d.toFixed(2) + " m"; }
  function fmtNs(d) { return (2 * d / C).toFixed(1) + " ns"; }
  function setText(el, v) { if (el.textContent !== v) el.textContent = v; }
  function readout() {
    var dist = "—", time = "—", pts = 0;
    if (phase === 0) {
      var f = Math.min(t, 2 * OUT_MS) / (2 * OUT_MS);
      time = (f * PULSE_NS).toFixed(1) + " ns";
      if (t >= 2 * OUT_MS) { dist = fmtM(PULSE_D); pts = 1; }
    } else if (phase === 1) {
      dist = fmtM(PULSE_D); time = PULSE_NS.toFixed(1) + " ns"; pts = 1;
    } else if (phase === 2) {
      var n = Math.floor(Math.min(1, t / SWEEP_MS) * RAYS), r = rays[Math.max(0, n - 1)];
      if (r.hit) { dist = fmtM(r.d); time = fmtNs(r.d); } else { dist = "No echo"; }
      pts = hitCount[n];
    } else if (phase === 3) {
      pts = TOTAL_HITS;
    } else {
      pts = TOTAL_HITS + walk.total;
      var lr = walk.lastRay;
      if (lr) { if (lr.hit) { dist = fmtM(lr.d); time = fmtNs(lr.d); } else { dist = "No echo"; } }
    }
    setText(roDist, dist); setText(roTime, time); setText(roPoints, pts.toLocaleString("en-US"));
  }

  // ---- Loop and controls ----
  var last = 0, lastRO = 0;
  function frame(now) {
    var dt = last ? Math.min(50, now - last) : 16;
    last = now;
    if (running && inView) {
      t += dt;
      if (phase === 4) updateWalk(dt);
      if (t >= PHASES[phase].dur) enterPhase((phase + 1) % PHASES.length);
      draw();
      if (now - lastRO > 100) { readout(); lastRO = now; }
    }
    requestAnimationFrame(frame);
  }
  function setRunning(on) {
    running = on;
    toggleBtn.textContent = on ? "Pause" : "Play";
  }
  toggleBtn.addEventListener("click", function () { setRunning(!running); });
  restartBtn.addEventListener("click", function () { enterPhase(0); setRunning(true); draw(); readout(); });
  stepBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      enterPhase(Number(b.dataset.step));
      if (!running && Number(b.dataset.step) === 4) t = PATH_DRAW;
      draw(); readout();
    });
  });

  function resize() {
    var r = canvas.getBoundingClientRect();
    if (!r.width) return;
    cssW = r.width; cssH = r.width * H / W; s = cssW / W;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    draw();
  }
  readColors();
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize", resize);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting;
      last = 0;
    }, { threshold: 0.15 }).observe(section);
  }
  function themeChanged() { readColors(); draw(); }
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", themeChanged);
  }
  new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);

  enterPhase(0);
  if (reduceMotion) { enterPhase(4); t = PATH_DRAW; setRunning(false); }
  resize(); readout();
  requestAnimationFrame(frame);
})();
