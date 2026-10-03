/* 피부결 분석 엔진 — 모든 처리는 브라우저 안에서만 수행됩니다. */
(function (root) {
  'use strict';
  const WORK = 360; // 분석 해상도 (정사각형)

  function boxesForGauss(sigma, n) {
    const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
    let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
    const m = Math.round(mIdeal);
    const sizes = [];
    for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
    return sizes;
  }
  function boxBlurH(src, dst, w, h, r) {
    const iarr = 1 / (r + r + 1);
    for (let i = 0; i < h; i++) {
      let ti = i * w, li = ti, ri = ti + r;
      const fv = src[ti], lv = src[ti + w - 1];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += src[ti + Math.min(j, w - 1)];
      for (let j = 0; j <= r; j++) { val += src[Math.min(ri++, ti + w - 1)] - fv; dst[ti++] = val * iarr; }
      for (let j = r + 1; j < w - r; j++) { val += src[ri++] - src[li++]; dst[ti++] = val * iarr; }
      for (let j = w - r; j < w; j++) { val += lv - src[li++]; dst[ti++] = val * iarr; }
    }
  }
  function boxBlurV(src, dst, w, h, r) {
    const iarr = 1 / (r + r + 1);
    for (let i = 0; i < w; i++) {
      let ti = i, li = ti, ri = ti + r * w;
      const fv = src[ti], lv = src[ti + w * (h - 1)];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += src[ti + Math.min(j, h - 1) * w];
      for (let j = 0; j <= r; j++) { val += src[Math.min(ri, ti + w * (h - 1))] - fv; ri += w; dst[ti] = val * iarr; ti += w; }
      for (let j = r + 1; j < h - r; j++) { val += src[ri] - src[li]; li += w; ri += w; dst[ti] = val * iarr; ti += w; }
      for (let j = h - r; j < h; j++) { val += lv - src[li]; li += w; dst[ti] = val * iarr; ti += w; }
    }
  }
  function gauss(src, w, h, sigma) {
    const out = Float32Array.from(src);
    if (sigma <= 0) return out;
    const tmp = new Float32Array(src.length);
    for (const b of boxesForGauss(sigma, 3)) {
      const r = (b - 1) / 2;
      if (r < 1) continue;
      boxBlurH(out, tmp, w, h, r);
      boxBlurV(tmp, out, w, h, r);
    }
    return out;
  }

  // 원시 지표 -> 0~100 점수 (낮을수록 좋은 지표)
  function toScore(x, good, bad) {
    const t = (x - good) / (bad - good);
    const s = 100 - 100 * Math.min(1, Math.max(0, t));
    return Math.round(Math.min(98, Math.max(15, s)));
  }

  function gradeOf(score) {
    if (score >= 85) return { key: 'S', label: '최상', desc: '매끈하고 고른 피부결이에요' };
    if (score >= 72) return { key: 'A', label: '우수', desc: '전반적으로 건강한 피부결이에요' };
    if (score >= 58) return { key: 'B', label: '양호', desc: '조금만 관리하면 더 좋아져요' };
    if (score >= 45) return { key: 'C', label: '보통', desc: '꾸준한 결 관리가 필요해요' };
    return { key: 'D', label: '집중 관리', desc: '집중적인 결 케어를 추천해요' };
  }

  /**
   * rgba: Uint8ClampedArray (WORK x WORK RGBA)
   * 반환: 점수, 원시 지표, 시각화 데이터
   */
  function analyzeRGBA(rgba, size) {
    const w = size, h = size, n = w * h;
    const L = new Float32Array(n);
    let sumL = 0, clip = 0, dark = 0, sumR = 0, sumG = 0, sumB = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      L[i] = y; sumL += y; sumR += r; sumG += g; sumB += b;
      if (y > 248) clip++;
      if (y < 20) dark++;
    }
    const meanL = sumL / n;

    // 1) 조명 보정: 큰 가우시안 블러로 조명 성분 추정 후 상대 고주파(%) 계산
    const B = gauss(L, w, h, w / 12);
    const Hn = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v = (L[i] - B[i]) / Math.max(B[i], 25) * 100;
      Hn[i] = Math.max(-35, Math.min(35, v)); // 반사광/털 등 극단값 억제
    }
    // 2) 센서 노이즈 억제
    const Hs = gauss(Hn, w, h, 0.9);

    // 가장자리 여백 (블러 경계 효과 제외)
    const m = 8;
    // --- 매끄러움(거칠기): 고주파 성분의 표준편차 ---
    let s1 = 0, s2 = 0, cnt = 0;
    for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++) {
      const v = Hs[y * w + x]; s1 += v; s2 += v * v; cnt++;
    }
    const mean = s1 / cnt;
    const rough = Math.sqrt(Math.max(0, s2 / cnt - mean * mean));

    // --- 모공: DoG(차영상 가우시안) 기반 어두운 점(blob) 검출 ---
    const D1 = gauss(Hs, w, h, 1.4), D2 = gauss(Hs, w, h, 4.0);
    const D = new Float32Array(n);
    for (let i = 0; i < n; i++) D[i] = D1[i] - D2[i];
    const pores = [];
    const thr = -3.0, R = 3;
    for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++) {
      const v = D[y * w + x];
      if (v > thr) continue;
      let isMin = true;
      for (let dy = -R; dy <= R && isMin; dy++) for (let dx = -R; dx <= R; dx++) {
        if ((dx || dy) && D[(y + dy) * w + x + dx] < v) { isMin = false; break; }
      }
      if (!isMin) continue;
      // 헤시안 고유값 비율로 '둥근 점'만 채택 (선/주름 위의 극소점 제외)
      const i = y * w + x, k = 2;
      const hxx = D1[i + k] + D1[i - k] - 2 * D1[i];
      const hyy = D1[i + k * w] + D1[i - k * w] - 2 * D1[i];
      const hxy = (D1[i + k + k * w] - D1[i + k - k * w] - D1[i - k + k * w] + D1[i - k - k * w]) / 4;
      const tr = hxx + hyy, dd = Math.sqrt((hxx - hyy) * (hxx - hyy) + 4 * hxy * hxy);
      const e1 = (tr + dd) / 2, e2 = (tr - dd) / 2;
      if (e2 <= 0 || e2 / e1 < 0.4) continue;
      pores.push({ x, y, s: -v });
    }
    const innerArea = (w - 2 * m) * (h - 2 * m);
    const poreDensity = pores.length / innerArea * 10000; // 1만 px 당 개수
    let poreDepth = 0; for (const p of pores) poreDepth += p.s;
    poreDepth = pores.length ? poreDepth / pores.length : 0;
    const poreIndex = poreDensity * Math.min(2, 0.6 + poreDepth / 8);

    // --- 잔주름: Sobel 기울기 + 구조 텐서 방향 일관성(선 형태만 강조) ---
    const G = gauss(Hs, w, h, 1.0);
    const Jxx = new Float32Array(n), Jyy = new Float32Array(n), Jxy = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (G[i - w + 1] + 2 * G[i + 1] + G[i + w + 1]) - (G[i - w - 1] + 2 * G[i - 1] + G[i + w - 1]);
      const gy = (G[i + w - 1] + 2 * G[i + w] + G[i + w + 1]) - (G[i - w - 1] + 2 * G[i - w] + G[i - w + 1]);
      Jxx[i] = gx * gx / 16; Jyy[i] = gy * gy / 16; Jxy[i] = gx * gy / 16;
    }
    const Sxx = gauss(Jxx, w, h, 3), Syy = gauss(Jyy, w, h, 3), Sxy = gauss(Jxy, w, h, 3);
    const lineMap = new Float32Array(n);
    let lsum = 0;
    for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++) {
      const i = y * w + x;
      const a = Sxx[i], c = Syy[i], b = Sxy[i];
      const tr = a + c, det = Math.sqrt((a - c) * (a - c) + 4 * b * b);
      const l1 = (tr + det) / 2, l2 = (tr - det) / 2;
      const coh = tr > 1e-6 ? Math.pow((l1 - l2) / (l1 + l2 + 1e-6), 2) : 0;
      const v = Math.sqrt(Math.max(0, l1)) * coh;
      lineMap[i] = v; lsum += v;
    }
    const lineIndex = lsum / cnt;

    // --- 국소 거칠기 맵 (히트맵용) ---
    const sq = new Float32Array(n);
    for (let i = 0; i < n; i++) sq[i] = Hs[i] * Hs[i];
    const localVar = gauss(sq, w, h, 7);

    // --- 촬영 품질 점검 ---
    let lap = 0;
    for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++) {
      const i = y * w + x;
      const v = 4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w];
      lap += v * v;
    }
    const sharp = Math.sqrt(lap / cnt) / Math.max(meanL, 25) * 100;
    const warnings = [];
    if (meanL < 60) warnings.push('사진이 어두워요. 더 밝은 곳에서 찍으면 정확해져요.');
    if (meanL > 220) warnings.push('사진이 너무 밝아요. 직사광선이나 강한 조명을 피해주세요.');
    if (clip / n > 0.04) warnings.push('번들거림(반사광)이 감지됐어요. 유분을 살짝 정돈하고 다시 찍어보세요.');
    if (sharp < 0.6) warnings.push('초점이 흐릿해 보여요. 카메라를 조금 떨어뜨려 초점을 맞춰주세요.');
    const rN = sumR / n, gN = sumG / n, bN = sumB / n;
    if (bN > rN * 1.05 || gN > rN * 1.08) warnings.push('피부 영역이 아닌 것 같아요. 가이드 안에 피부만 들어오게 찍어주세요.');

    // --- 점수화 (보정값: 합성 테스트 + 일반적 근접 촬영 피부 기준) ---
    const smooth = toScore(rough, 2.0, 11.0);
    const pore = toScore(poreIndex, 4, 80);
    const lines = toScore(lineIndex, 0.25, 2.2);
    const overall = Math.round(smooth * 0.4 + pore * 0.3 + lines * 0.3);

    return {
      scores: { overall, smooth, pore, lines },
      grade: gradeOf(overall),
      raw: { rough, poreDensity, poreDepth, poreIndex, lineIndex, meanL, sharp, clip: clip / n },
      warnings,
      viz: { size: w, localVar, lineMap, pores },
    };
  }

  // 시각화: 원본 위에 거칠기 히트맵 + 잔주름 + 모공 표시
  function renderOverlay(ctx, srcCanvas, viz, mode) {
    const s = viz.size;
    const W = ctx.canvas.width, k = W / s;
    ctx.drawImage(srcCanvas, 0, 0, W, W);
    if (mode === 'original') return;
    const img = ctx.createImageData(s, s);
    for (let i = 0; i < s * s; i++) {
      const p = i * 4;
      if (mode === 'heat') {
        const v = Math.sqrt(viz.localVar[i]);
        const t = Math.min(1, Math.max(0, (v - 1.5) / 7));
        // 민트(매끈) → 노랑 → 코랄(거침)
        const r = t < 0.5 ? 90 + 330 * t : 255;
        const g = t < 0.5 ? 200 + 30 * t : 215 - 250 * (t - 0.5);
        const b = t < 0.5 ? 180 - 260 * t : 50 + 60 * (t - 0.5);
        img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 85 + 80 * t;
      } else if (mode === 'lines') {
        const t = Math.min(1, Math.max(0, (viz.lineMap[i] - 0.5) / 2.5));
        img.data[p] = 255; img.data[p + 1] = 70; img.data[p + 2] = 140; img.data[p + 3] = 230 * t;
      }
    }
    if (mode === 'heat' || mode === 'lines') {
      const c = document.createElement('canvas'); c.width = c.height = s;
      c.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(c, 0, 0, W, W);
    }
    if (mode === 'pores') {
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, 0, W, W);
      ctx.lineWidth = Math.max(1.5, k * 0.8);
      for (const p of viz.pores) {
        ctx.strokeStyle = p.s > 6 ? 'rgba(232,74,95,0.95)' : 'rgba(255,170,60,0.95)';
        ctx.beginPath(); ctx.arc(p.x * k, p.y * k, Math.max(3, (2 + p.s / 3) * k * 0.9), 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  root.SkinAnalyzer = { WORK, analyzeRGBA, renderOverlay, gradeOf, gauss };
})(typeof window !== 'undefined' ? window : globalThis);
