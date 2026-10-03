/* H.O.W 얼굴 전체 분석 — 구역별 붉은기·유분(광택)·결(참고)
 * 입력: RGBA 픽셀 + MediaPipe Face Landmarker 478점(정규화 좌표). 모든 계산은 기기 안에서.
 * 값은 "같은 사진 안에서의 상대 비교"이며 조명/카메라에 따라 달라지는 참고값이다. (의학적 진단 아님) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HowFaceAnalyze = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // 구역: 랜드마크 집합의 볼록 껍질(순서 무관). group T=T존, U=U존(볼), E=눈밑
  var ZONES = [
    { key: 'forehead', name: '이마', group: 'T', idx: [109, 10, 338, 297, 299, 9, 69, 67, 108, 151, 337] },
    { key: 'nose', name: '코', group: 'T', idx: [168, 6, 197, 195, 5, 4, 1, 45, 275, 220, 440, 115, 344, 131, 360] },
    { key: 'cheekL', name: '왼쪽 볼', group: 'U', idx: [123, 50, 36, 205, 206, 207, 187, 147, 216] },
    { key: 'cheekR', name: '오른쪽 볼', group: 'U', idx: [352, 280, 266, 425, 426, 427, 411, 376, 436] },
    { key: 'chin', name: '턱', group: 'T', idx: [83, 18, 313, 418, 421, 428, 199, 208, 201, 194, 32, 262, 200] },
    { key: 'eyeL', name: '왼쪽 눈밑', group: 'E', idx: [31, 228, 229, 230, 231, 232, 117, 118, 119, 120, 121] },
    { key: 'eyeR', name: '오른쪽 눈밑', group: 'E', idx: [261, 448, 449, 450, 451, 452, 346, 347, 348, 349, 350] },
  ];
  var LEVEL = ['낮음', '보통', '높음'];
  // 등급 기준 (테스트 사진으로 보정)
  var RED_T = [10, 25];        // 얼굴 평균 대비 a* 증가율(%)
  var SHINE_T = [1.5, 4];     // 광택(정반사) 픽셀 비율(%)

  function srgbLin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  var LUT = new Float32Array(256); for (var i = 0; i < 256; i++) LUT[i] = srgbLin(i);
  function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  function lab(r, g, b) {
    var R = LUT[r], G = LUT[g], B = LUT[b];
    var X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    var fx = f(X), fy = f(Y), fz = f(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function hull(pts) {
    var p = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [], k;
    for (k = 0; k < p.length; k++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p[k]) <= 0) lo.pop(); lo.push(p[k]); }
    for (k = p.length - 1; k >= 0; k--) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p[k]) <= 0) up.pop(); up.push(p[k]); }
    up.pop(); lo.pop(); return lo.concat(up);
  }
  function inPoly(x, y, P) {
    var ins = false;
    for (var i = 0, j = P.length - 1; i < P.length; j = i++) {
      var xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  function median(arr) { if (!arr.length) return 0; var s = Float64Array.from(arr).sort(); return s[Math.floor(s.length / 2)]; }
  function pct(arr, q) { if (!arr.length) return 0; var s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; }
  function level(v, T) { return v < T[0] ? 0 : v < T[1] ? 1 : 2; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // 얼굴 기하 검사 (사진 품질 검사 전)
  function geometry(lm, W, H) {
    var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, out = 0;
    for (var i = 0; i < lm.length; i++) {
      var x = lm[i].x, y = lm[i].y;
      if (x < 0 || x > 1 || y < 0 || y > 1) out++;
      minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
    }
    var fw = (maxx - minx) * W, fh = (maxy - miny) * H;
    var L = lm[234], R = lm[454], N = lm[1], eL = lm[33], eR = lm[263];
    var mid = (L.x + R.x) / 2, half = Math.abs(R.x - L.x) / 2 || 1e-6;
    var yaw = (N.x - mid) / half;
    var roll = Math.atan2((eR.y - eL.y) * H, (eR.x - eL.x) * W) * 180 / Math.PI;
    if (roll > 90) roll -= 180; if (roll < -90) roll += 180;
    var eyeY = (eL.y + eR.y) / 2, chin = lm[152].y, pitch = (N.y - eyeY) / ((chin - eyeY) || 1e-6);
    return { box: [minx * W, miny * H, fw, fh], faceW: fw, faceH: fh, widthFrac: fw / W, yaw: yaw, roll: roll, pitch: pitch, outside: out / lm.length };
  }
  function geometryBlockers(g, W, H) {
    var b = [];
    if (g.outside > 0.02) b.push('얼굴 일부가 화면 밖으로 나갔어요. 얼굴 전체가 들어오게 찍어주세요.');
    if (g.faceW < 180 || g.widthFrac < 0.24) b.push('얼굴이 너무 작게 찍혔어요. 얼굴이 가이드 타원을 채우도록 조금 더 가까이에서 찍어주세요.');
    if (Math.abs(g.yaw) > 0.24) b.push('고개가 옆으로 돌아갔어요. 카메라를 정면으로 바라봐 주세요.');
    if (Math.abs(g.roll) > 13) b.push('고개가 기울어졌어요. 얼굴을 똑바로 세워 주세요.');
    if (g.pitch < 0.22 || g.pitch > 0.62) b.push('고개를 너무 숙이거나 들었어요. 카메라와 눈높이를 맞춰 주세요.');
    return b;
  }

  /* rgba: Uint8ClampedArray, W,H, lm: [{x,y}] 478, faces: 감지된 얼굴 수 */
  function analyze(rgba, W, H, lm, faces) {
    var res = { invalid: false, blockers: [], warnings: [], zones: {}, order: ZONES.map(function (z) { return z.key; }) };
    if (!faces || !lm) { res.invalid = true; res.blockers.push('얼굴을 찾지 못했어요. 밝은 곳에서 얼굴 전체가 나오게 정면으로 찍어주세요.'); return res; }
    if (faces > 1) { res.invalid = true; res.blockers.push('여러 얼굴이 보여요. 한 사람만 나오게 찍어주세요.'); return res; }
    var g = geometry(lm, W, H); res.geometry = g;
    var gb = geometryBlockers(g, W, H);
    if (gb.length) { res.invalid = true; res.blockers = gb; return res; }
    var step = Math.max(1, Math.round(g.faceW / 280)); // 얼굴 폭 기준으로 일정한 표본 밀도
    var d = step; // 결(라플라시안) 이웃 거리
    var all = { L: [], a: [], C: [] };
    var zs = ZONES.map(function (z) {
      var P = hull(z.idx.map(function (i) { return [lm[i].x * W, lm[i].y * H]; }));
      var xs = P.map(function (p) { return p[0]; }), ys = P.map(function (p) { return p[1]; });
      var x0 = Math.max(d, Math.floor(Math.min.apply(null, xs))), x1 = Math.min(W - 1 - d, Math.ceil(Math.max.apply(null, xs)));
      var y0 = Math.max(d, Math.floor(Math.min.apply(null, ys))), y1 = Math.min(H - 1 - d, Math.ceil(Math.max.apply(null, ys)));
      var px = [];
      for (var y = y0; y <= y1; y += step) for (var x = x0; x <= x1; x += step) {
        if (!inPoly(x, y, P)) continue;
        var k = (y * W + x) * 4, c = lab(rgba[k], rgba[k + 1], rgba[k + 2]);
        var gy = function (xx, yy) { var q = (yy * W + xx) * 4; return 0.299 * rgba[q] + 0.587 * rgba[q + 1] + 0.114 * rgba[q + 2]; };
        var lap = Math.abs(4 * gy(x, y) - gy(x - d, y) - gy(x + d, y) - gy(x, y - d) - gy(x, y + d)) / 4;
        px.push([c[0], c[1], c[2], Math.sqrt(c[1] * c[1] + c[2] * c[2]), lap, rgba[k], rgba[k + 1], rgba[k + 2], x, y]);
      }
      return { z: z, P: P, px: px };
    });
    zs.forEach(function (o) { o.px.forEach(function (p) { all.L.push(p[0]); }); });
    var medL0 = median(all.L);
    // 눈썹·머리카락·그림자 같은 어두운 비피부 픽셀 제외
    zs.forEach(function (o) { o.px = o.px.filter(function (p) { return p[0] > medL0 - 24; }); });
    all = { L: [], a: [], C: [] };
    zs.forEach(function (o) { o.px.forEach(function (p) { all.L.push(p[0]); all.a.push(p[1]); all.C.push(p[3]); }); });
    var n = all.L.length;
    if (n < 400) { res.invalid = true; res.blockers.push('피부 영역을 충분히 찾지 못했어요. 머리카락·손·안경이 얼굴을 가리지 않게 다시 찍어주세요.'); return res; }
    var medL = median(all.L), medA = median(all.a), medC = median(all.C);
    var sdL = 0; for (var i = 0; i < n; i++) sdL += (all.L[i] - medL) * (all.L[i] - medL); sdL = Math.sqrt(sdL / n);
    var bright = pct(all.L, 0.99);
    if (medL < 32) { res.invalid = true; res.blockers.push('사진이 너무 어두워요. 얼굴에 빛이 고르게 닿는 밝은 곳에서 다시 찍어주세요.'); return res; }
    if (medL > 88) { res.invalid = true; res.blockers.push('빛이 너무 강해 피부가 하얗게 날아갔어요. 직사광선을 피해 다시 찍어주세요.'); return res; }
    var aRef = Math.max(medA, 6);
    var shineL = Math.min(97, medL + Math.max(7, 1.3 * sdL)), shineC = medC * 0.85;
    var redA = medA + Math.max(4, 0.3 * aRef);
    res.face = { L: +medL.toFixed(1), a: +medA.toFixed(1), C: +medC.toFixed(1), sdL: +sdL.toFixed(1), step: step, px: n };
    var texScale = 1; // 표본 밀도가 얼굴 폭에 맞춰져 있어 별도 보정 불필요
    var skin = [[], [], []], groups = { T: [0, 0], U: [0, 0] };
    zs.forEach(function (o) {
      var z = o.z, P = o.px, m = P.length;
      if (m < 30) { res.zones[z.key] = { key: z.key, name: z.name, group: z.group, poly: o.P, px: m, missing: true }; return; }
      var aArr = [], lapArr = [], sh = 0, rd = 0, Lsum = 0;
      var shinePts = [], redPts = [];
      for (var j = 0; j < m; j++) {
        var p = P[j]; aArr.push(p[1]); lapArr.push(p[4]); Lsum += p[0];
        var isShine = p[0] >= shineL && p[3] <= shineC;
        if (isShine) { sh++; shinePts.push(p[8], p[9]); }
        if (p[1] >= redA) { rd++; redPts.push(p[8], p[9]); }
        if (!isShine && (z.group !== 'E')) { skin[0].push(p[5]); skin[1].push(p[6]); skin[2].push(p[7]); }
      }
      var za = median(aArr);
      var redPct = (za - medA) / aRef * 100;
      var shinePct = sh / m * 100;
      var tex = median(lapArr) * texScale;
      // 코·눈밑은 주름·음영 경계가 많아 결 값이 왜곡되므로 표시하지 않음
      var texture = (z.key === 'nose' || z.group === 'E') ? null : Math.round(clamp(100 - (tex - 1.2) * 14, 5, 99));
      var zr = { key: z.key, name: z.name, group: z.group, poly: o.P, px: m, L: +(Lsum / m).toFixed(1), a: +za.toFixed(1),
        redPct: Math.round(redPct), redFrac: Math.round(rd / m * 100), redLevel: level(redPct, RED_T),
        shine: +shinePct.toFixed(1), shineLevel: level(shinePct, SHINE_T), texture: texture,
        // 0~100 표시용 막대값: 50 = 얼굴 평균
        redBar: Math.round(clamp(50 + redPct * 2, 0, 100)), shineBar: Math.round(clamp(shinePct * 10, 0, 100)),
        shinePts: shinePts, redPts: redPts };
      res.zones[z.key] = zr;
      if (groups[z.group]) { groups[z.group][0] += sh; groups[z.group][1] += m; }
    });
    var T = groups.T[1] ? groups.T[0] / groups.T[1] * 100 : 0, U = groups.U[1] ? groups.U[0] / groups.U[1] * 100 : 0;
    res.tShine = +T.toFixed(1); res.uShine = +U.toFixed(1);
    res.tLevel = level(T, SHINE_T); res.uLevel = level(U, SHINE_T);
    res.type = skinType(T, U);
    res.skinRGB = [median(skin[0]), median(skin[1]), median(skin[2])];
    // 조명 경고
    var cl = res.zones.cheekL, cr = res.zones.cheekR;
    if (cl && cr && !cl.missing && !cr.missing && Math.abs(cl.L - cr.L) > 12) res.warnings.push('얼굴 한쪽에 그림자가 있어요. 양쪽 볼 비교는 참고만 해주세요.');
    if (sdL > 14) res.warnings.push('조명이 고르지 않아요. 창을 마주 보는 자연광에서 찍으면 더 정확해요.');
    if (bright > 97) res.warnings.push('하얗게 반사된 부분이 있어요. 조명 반사가 유분으로 보일 수 있어요.');
    res.summary = summarize(res);
    res.texture = Math.round(avg(ZONES.filter(function (z) { return z.group !== 'E'; }).map(function (z) { return res.zones[z.key] && res.zones[z.key].texture; }).filter(function (v) { return v != null; })));
    return res;
  }
  function avg(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : 0; }
  function skinType(T, U) {
    var hi = SHINE_T[1], lo = SHINE_T[0];
    if ((T >= hi && U >= lo) || (T >= lo * 1.7 && U >= lo * 1.7)) return { key: 'oily', name: '지성 경향' };
    if (T >= lo * 1.5 && T >= U * 1.5) return { key: 'combo', name: '복합성 경향' };
    if (T >= hi) return { key: 'oily', name: '지성 경향' };
    return { key: 'drynormal', name: '건성·중성 경향' };
  }
  function summarize(r) {
    var parts = [];
    parts.push('T존 유분 ' + LEVEL[r.tLevel]);
    parts.push('볼 유분 ' + LEVEL[r.uLevel]);
    var cl = r.zones.cheekL, cr = r.zones.cheekR;
    var cheekRed = Math.max(cl && !cl.missing ? cl.redLevel : 0, cr && !cr.missing ? cr.redLevel : 0);
    var both = cl && cr && !cl.missing && !cr.missing && cl.redLevel === cr.redLevel;
    parts.push((both ? '양 볼' : '볼') + ' 붉은기 ' + LEVEL[cheekRed]);
    var hi = ZONES.filter(function (z) { var x = r.zones[z.key]; return x && !x.missing && x.redLevel === 2 && z.group !== 'U'; }).map(function (z) { return z.name; });
    if (hi.length) parts.push(hi.join('·') + ' 붉은기 높음');
    return parts.join(', ');
  }
  // 저장용 숫자만 (사진·좌표 없음)
  function compact(r) {
    var z = {};
    ZONES.forEach(function (d) { var x = r.zones[d.key]; if (x && !x.missing) z[d.key] = [x.redPct, x.shine, x.texture]; });
    return { t: r.tShine, u: r.uShine, type: r.type.key, z: z };
  }
  return { ZONES: ZONES, LEVEL: LEVEL, RED_T: RED_T, SHINE_T: SHINE_T, analyze: analyze, geometry: geometry, geometryBlockers: geometryBlockers, skinType: skinType, summarize: summarize, compact: compact, lab: lab, hull: hull };
});
