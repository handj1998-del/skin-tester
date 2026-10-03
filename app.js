(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const SA = window.SkinAnalyzer;
  const HKEY = 'skinTexture.history.v1';
  const GUIDE_FRAC = 0.62;     // 화면 짧은 변 대비 가이드 크기
  const UPLOAD_FRAC = 0.7;     // 업로드 사진 중앙 크롭 비율

  let stream = null, facing = 'environment', meterTimer = null, torchOn = false;
  let current = null; // {result, canvas, ts, saved}

  // ---------- 화면 전환 ----------
  function show(id) {
    try {
      if (id !== 'intro' && !(history.state && history.state.app)) history.pushState({ app: 1 }, '');
      else if (id === 'intro' && history.state && history.state.app && !show._pop) { show._expectPop = true; history.back(); }
    } catch (e) {}
    show._pop = false;
    document.querySelectorAll('.screen').forEach((s) => { const on = s.id === 'screen-' + id; s.classList.toggle('active', on); s.setAttribute('aria-hidden', on ? 'false' : 'true'); });
    window.scrollTo(0, 0);
    const h = document.querySelector('#screen-' + id + ' h1, #screen-' + id + ' h2, #screen-' + id + ' .topbar span');
    if (h && id !== 'intro' && h.offsetParent) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) {} }
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------- 카메라 ----------
  // 인앱 브라우저 감지 (카카오톡·네이버·인스타그램·페이스북·라인·밴드 등)
  const UA = navigator.userAgent || '';
  const IS_ANDROID = /Android/i.test(UA);
  const IS_IOS = /iPhone|iPad|iPod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const INAPP = (() => {
    const list = [['KAKAOTALK', '카카오톡'], ['NAVER\\(inapp|NAVER/', '네이버 앱'], ['Instagram', '인스타그램'], ['FBAN|FBAV|FB_IAB', '페이스북'], ['\\bLine/', '라인'], ['BAND/', '밴드'], ['DaumApps', '다음 앱'], ['everytimeApp', '에브리타임']];
    for (const [re, name] of list) if (new RegExp(re, 'i').test(UA)) return name;
    if (IS_ANDROID && /; wv\)/.test(UA)) return '앱 내 브라우저';
    return null;
  })();
  function externalOpenUrl() {
    const url = location.href;
    if (/KAKAOTALK/i.test(UA)) return 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
    if (IS_ANDROID) return 'intent://' + url.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(url) + ';end';
    return null;
  }
  function setupInappBanner() {
    if (!INAPP) return;
    const b = $('#inapp-banner'); b.hidden = false;
    $('#inapp-name').textContent = INAPP;
    $('#inapp-browser').textContent = IS_IOS ? 'Safari' : 'Chrome';
    const ext = externalOpenUrl(), btn = $('#btn-open-external');
    if (ext) { btn.href = ext; btn.hidden = false; btn.textContent = IS_IOS ? 'Safari로 열기' : 'Chrome으로 열기'; }
    else btn.hidden = true;
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(location.href); toast('링크를 복사했어요. Chrome/Safari 주소창에 붙여넣어 주세요'); }
    catch (e) { prompt('아래 주소를 복사해 Chrome/Safari에서 열어주세요', location.href); }
  }

  function constraintChain(face) {
    // exact 제약/torch/focus는 초기 요청에 넣지 않음 (기기별 OverconstrainedError 방지)
    return [
      { audio: false, video: { facingMode: { ideal: face }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
      { audio: false, video: { facingMode: face } },
      { audio: false, video: true },
    ];
  }
  const camLog = (window.__camLog = []);
  async function openStream(face) {
    let lastErr = null;
    for (const c of constraintChain(face)) {
      try {
        camLog.push({ try: c });
        const s = await navigator.mediaDevices.getUserMedia(c);
        camLog.push({ ok: true });
        return s;
      } catch (e) {
        lastErr = e; camLog.push({ err: e && e.name });
        const n = e && e.name;
        // 권한/보안 문제는 제약을 바꿔도 해결되지 않으므로 즉시 중단
        if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError' || n === 'TypeError') break;
      }
    }
    throw lastErr || new Error('unknown');
  }

  // 반드시 사용자 탭 핸들러에서 직접 호출 (getUserMedia 이전에 await 없음)
  function startCamera() {
    show('camera');
    hideCamError();
    $('#tap-to-play').hidden = true;
    stopCamera();
    if (!window.isSecureContext) {
      return camError('insecure');
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      return camError(INAPP ? 'inapp' : 'unsupported');
    }
    const req = ++startCamera.seq;
    return openStream(facing).then(async (s) => {
      if (req !== startCamera.seq || !$('#screen-camera').classList.contains('active')) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      const v = $('#video');
      v.muted = true; v.playsInline = true; v.autoplay = true;
      v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('muted', '');
      v.srcObject = s;
      v.classList.toggle('mirror', facing === 'user');
      try { await v.play(); }
      catch (e) { $('#tap-to-play').hidden = false; } // 자동재생 차단 시 탭하여 시작
      layoutGuide();
      afterStreamStarted(s);
      meterTimer = setInterval(updateMeter, 600);
    }).catch((e) => {
      if (req !== startCamera.seq) return;
      console.warn('camera failed', e && e.name, e && e.message);
      camError((e && e.name) || 'unknown');
    });
  }
  startCamera.seq = 0;
  function afterStreamStarted(s) {
    const track = s.getVideoTracks()[0];
    let caps = {};
    try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (e) { caps = {}; }
    $('#btn-torch').hidden = !caps.torch;
    // 연속 자동초점은 스트림 시작 이후에만, 실패해도 무시
    if (caps.focusMode && caps.focusMode.includes && caps.focusMode.includes('continuous')) {
      try { track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}); } catch (e) {}
    }
  }
  const PERM_HELP_ANDROID = '<ol><li>Chrome 주소창 왼쪽의 <b>자물쇠(또는 ⓘ/조절) 아이콘</b>을 누르세요</li><li><b>권한 → 카메라 → 허용</b>으로 바꾸세요</li><li>페이지를 새로고침한 뒤 다시 시도하세요</li></ol><p class="small">또는 Chrome ⋮ 메뉴 → 설정 → 사이트 설정 → 카메라에서 이 사이트를 허용으로 바꿔주세요. 휴대폰 설정 → 애플리케이션 → Chrome → 권한 → 카메라도 허용되어 있어야 해요.</p>';
  const PERM_HELP_IOS = '<ol><li>주소창의 <b>“가가”(aA) 버튼 → 웹사이트 설정 → 카메라 → 허용</b></li><li>또는 설정 앱 → Safari → 카메라 → 허용</li><li>페이지를 새로고침한 뒤 다시 시도하세요</li></ol>';
  const CAM_ERRORS = {
    insecure: ['보안 연결이 아니에요', '카메라는 HTTPS 주소에서만 사용할 수 있어요. https:// 로 시작하는 주소로 열어주세요.'],
    unsupported: ['이 브라우저는 실시간 카메라를 지원하지 않아요', 'Chrome(안드로이드) 또는 Safari(아이폰)로 열거나, 아래 버튼으로 기본 카메라 앱을 이용해 촬영해 주세요.'],
    inapp: ['앱 내 브라우저에서는 카메라가 제한돼요', '카카오톡·인스타그램 등 앱 안의 브라우저는 실시간 카메라를 막는 경우가 많아요. Chrome/Safari로 열거나, 아래 버튼으로 기본 카메라 앱을 이용해 주세요.'],
    NotAllowedError: ['카메라 권한이 꺼져 있어요', null],
    PermissionDeniedError: ['카메라 권한이 꺼져 있어요', null],
    SecurityError: ['보안 설정 때문에 카메라를 쓸 수 없어요', '앱 내 브라우저라면 Chrome/Safari로 열어주세요.'],
    NotReadableError: ['다른 앱이 카메라를 사용 중이에요', '카메라를 쓰고 있는 다른 앱(영상통화, 카메라 앱 등)이나 다른 브라우저 탭을 종료한 뒤 다시 시도해 주세요. 계속되면 휴대폰을 재시작해 보세요.'],
    TrackStartError: ['다른 앱이 카메라를 사용 중이에요', '카메라를 쓰는 다른 앱을 종료한 뒤 다시 시도해 주세요.'],
    AbortError: ['카메라를 시작하지 못했어요', '잠시 후 다시 시도하거나 아래 버튼으로 기본 카메라 앱을 이용해 주세요.'],
    OverconstrainedError: ['이 기기에 맞는 카메라 설정을 찾지 못했어요', '여러 설정으로 다시 시도했지만 실패했어요. 아래 버튼으로 기본 카메라 앱을 이용해 주세요.'],
    NotFoundError: ['카메라를 찾을 수 없어요', '기기에 사용할 수 있는 카메라가 없거나 꺼져 있어요. 아래 버튼으로 사진을 촬영/선택해 주세요.'],
    DevicesNotFoundError: ['카메라를 찾을 수 없어요', '아래 버튼으로 사진을 촬영/선택해 주세요.'],
    unknown: ['카메라를 시작할 수 없어요', '아래 버튼으로 기본 카메라 앱을 이용해 촬영해 주세요.'],
  };
  function camError(code) {
    const [title, body] = CAM_ERRORS[code] || CAM_ERRORS.unknown;
    $('#cam-error-title').textContent = title;
    const el = $('#cam-error-text');
    if (code === 'NotAllowedError' || code === 'PermissionDeniedError') {
      el.innerHTML = (INAPP ? '<p>' + INAPP + ' 안의 브라우저는 카메라 권한을 줄 수 없는 경우가 많아요. <b>Chrome/Safari로 열어주세요.</b></p>' : '<p>카메라 접근이 거부되었어요. 아래 방법으로 허용해 주세요.</p>') + (IS_IOS ? PERM_HELP_IOS : PERM_HELP_ANDROID);
    } else el.textContent = body;
    const ext = INAPP && externalOpenUrl();
    const eb = $('#cam-error-external');
    if (ext) { eb.href = ext; eb.hidden = false; eb.textContent = IS_IOS ? 'Safari로 열기' : 'Chrome으로 열기'; } else eb.hidden = true;
    $('#cam-error').dataset.code = code;
    $('#cam-error').hidden = false;
  }
  function hideCamError() { $('#cam-error').hidden = true; }
  function stopCamera() {
    clearInterval(meterTimer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; torchOn = false;
    const v = document.querySelector('#video'); if (v) v.srcObject = null;
  }
  function layoutGuide() {
    const wrap = $('#cam-wrap');
    const g = Math.min(wrap.clientWidth, wrap.clientHeight) * GUIDE_FRAC;
    $('#cam-guide').style.setProperty('--g', g + 'px');
  }
  // 화면의 가이드 사각형 → 비디오 원본 픽셀 좌표 (object-fit: cover 보정)
  function guideRectInVideo() {
    const v = $('#video'), wrap = $('#cam-wrap');
    const vw = v.videoWidth, vh = v.videoHeight, cw = wrap.clientWidth, ch = wrap.clientHeight;
    const scale = Math.max(cw / vw, ch / vh);
    const dispW = vw * scale, dispH = vh * scale;
    const offX = (cw - dispW) / 2, offY = (ch - dispH) / 2;
    const g = Math.min(cw, ch) * GUIDE_FRAC;
    const gx = (cw - g) / 2, gy = (ch - g) / 2;
    const size = g / scale;
    return { sx: (gx - offX) / scale, sy: (gy - offY) / scale, size };
  }
  function updateMeter() {
    const v = $('#video'); if (!v.videoWidth) return;
    const r = guideRectInVideo();
    const c = document.createElement('canvas'); c.width = c.height = 48;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(v, r.sx, r.sy, r.size, r.size, 0, 0, 48, 48);
    const d = x.getImageData(0, 0, 48, 48).data;
    let s = 0, clip = 0;
    for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; s += y; if (y > 248) clip++; }
    const m = s / (d.length / 4), el = $('#light-meter');
    let txt = '밝기 좋음', ok = true;
    if (m < 70) { txt = '조금 더 밝은 곳으로'; ok = false; }
    else if (m > 215 || clip > 120) { txt = '빛이 너무 강해요'; ok = false; }
    el.classList.toggle('good', ok); el.classList.toggle('bad', !ok);
    $('#light-text').textContent = txt;
    $('#cam-guide').classList.toggle('ok', ok);
  }
  let busy = false;
  function captureFromVideo() {
    if (busy) return;
    const v = $('#video'); if (!v.videoWidth) return toast('카메라가 준비 중이에요');
    const r = guideRectInVideo();
    const c = makeWorkCanvas((ctx, N) => ctx.drawImage(v, r.sx, r.sy, r.size, r.size, 0, 0, N, N));
    stopCamera();
    runAnalysis(c);
  }
  function makeWorkCanvas(drawFn) {
    const N = SA.WORK;
    const c = document.createElement('canvas'); c.width = c.height = N;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    drawFn(ctx, N);
    return c;
  }

  // ---------- 업로드 ----------
  function loadImage(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  }
  async function fromImage(im) {
    const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    const size = Math.min(w, h) * UPLOAD_FRAC;
    const sx = (w - size) / 2, sy = (h - size) / 2;
    // 큰 사진은 2단계 축소로 계단 현상 방지
    let src = im, ssx = sx, ssy = sy, ss = size;
    if (size > SA.WORK * 2.5) {
      const mid = document.createElement('canvas'); mid.width = mid.height = SA.WORK * 2;
      const mx = mid.getContext('2d'); mx.imageSmoothingQuality = 'high';
      mx.drawImage(im, sx, sy, size, size, 0, 0, mid.width, mid.height);
      src = mid; ssx = 0; ssy = 0; ss = mid.width;
    }
    return makeWorkCanvas((ctx, N) => ctx.drawImage(src, ssx, ssy, ss, ss, 0, 0, N, N));
  }
  async function onFile(e) {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f || busy) return;
    if (f.type && !/^image\//.test(f.type)) return toast('이미지 파일만 분석할 수 있어요');
    stopCamera();
    const url = URL.createObjectURL(f);
    try { const im = await loadImage(url); runAnalysis(await fromImage(im)); }
    catch (err) { toast('사진을 불러오지 못했어요'); show('intro'); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
  }

  // ---------- 분석 ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function runAnalysis(canvas, fast) {
    busy = true;
    try { return await doAnalysis(canvas, fast); } finally { busy = false; }
  }
  async function doAnalysis(canvas, fast) {
    show('analyzing');
    const sc = $('#scan-canvas'); sc.getContext('2d').drawImage(canvas, 0, 0, sc.width, sc.height);
    const steps = ['조명 보정 중…', '피부 표면 거칠기 측정 중…', '모공 패턴 찾는 중…', '잔주름 방향성 분석 중…'];
    const data = canvas.getContext('2d').getImageData(0, 0, SA.WORK, SA.WORK).data;
    const result = SA.analyzeRGBA(data, SA.WORK);
    if (!fast) for (const s of steps) { $('#analyze-step').textContent = s; await sleep(480); }
    current = { result, canvas, ts: Date.now(), saved: false };
    renderResult();
    return result;
  }

  // ---------- 결과 ----------
  const METRICS = [
    { key: 'smooth', name: '매끄러움', ic: '🫧', desc: '표면 요철·거칠기가 적을수록 높아요' },
    { key: 'pore', name: '모공', ic: '🔎', desc: '눈에 띄는 모공(어두운 점)이 적을수록 높아요' },
    { key: 'lines', name: '잔주름', ic: '〰️', desc: '가는 선 형태의 결 꺾임이 적을수록 높아요' },
  ];
  const TIPS = {
    smooth: { ic: '🫧', t: '매끄러움 케어', p: '주 1~2회 저자극 각질 케어(PHA·LHA 등)로 묵은 각질을 정돈하고, 세라마이드·판테놀 보습제로 장벽을 채워주세요. 뜨거운 물 세안은 피해주세요.' },
    pore: { ic: '🔎', t: '모공 케어', p: '저녁엔 약산성 클렌저로 꼼꼼히 세안하고, BHA(살리실산)·나이아신아마이드 제품을 꾸준히 사용해 보세요. 피지가 많은 날은 유분 조절 토너가 도움돼요.' },
    lines: { ic: '〰️', t: '잔주름 케어', p: '건조로 생기는 잔주름은 수분 공급이 우선! 히알루론산 세럼 + 크림으로 수분을 잠그고, 낮에는 자외선 차단제를 꼭 덧발라 주세요. 레티놀은 저농도부터 천천히.' },
    good: { ic: '✨', t: '지금처럼 유지해요', p: '좋은 피부결이에요. 충분한 수면과 수분 섭취, 매일 자외선 차단을 지켜주세요. 같은 조건으로 주 1회 측정하면 변화를 확인할 수 있어요.' },
  };
  function barColor(s) { return s >= 75 ? 'linear-gradient(90deg,#9fd8c8,#5fb8a2)' : s >= 55 ? 'linear-gradient(90deg,#f3cf8e,#d9a95b)' : 'linear-gradient(90deg,#f2a58f,#e8765f)'; }
  function label(s) { return s >= 85 ? '아주 좋음' : s >= 70 ? '좋음' : s >= 55 ? '보통' : s >= 40 ? '관리 필요' : '집중 관리'; }
  function fmtDate(ts) { const d = new Date(ts); return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

  function renderResult() {
    const { result, ts } = current, s = result.scores;
    show('result');
    $('#screen-result').classList.toggle('invalid', !!result.invalid);
    if (result.invalid) {
      $('#res-date').textContent = fmtDate(ts);
      $('#invalid-reasons').innerHTML = result.blockers.map((x) => `<li>${x}</li>`).join('');
      $('#res-warn').hidden = true;
      const ctx = $('#viz-canvas').getContext('2d'); SA.renderOverlay(ctx, current.canvas, result.viz, 'original');
      $('#invalid-thumb').getContext('2d').drawImage(current.canvas, 0, 0, 240, 240);
      return;
    }
    $('#res-date').textContent = fmtDate(ts);
    $('#res-overall').textContent = s.overall;
    $('#ring').setAttribute('aria-label', `피부결 점수 ${s.overall}점, 등급 ${result.grade.key} ${result.grade.label}`);
    $('#res-grade').textContent = result.grade.key;
    $('#res-grade-label').textContent = result.grade.label;
    $('#res-grade-desc').textContent = result.grade.desc;
    const bar = $('#ring-bar');
    bar.style.stroke = s.overall >= 72 ? '#5fb8a2' : s.overall >= 55 ? '#d9a95b' : '#e8765f';
    bar.style.strokeDashoffset = 326.7;
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.strokeDashoffset = 326.7 * (1 - s.overall / 100); }));
    // 경고
    const w = $('#res-warn');
    w.hidden = !result.warnings.length;
    w.innerHTML = result.warnings.map((x) => `<p>⚠️ ${x}</p>`).join('');
    // 항목
    $('#metrics').innerHTML = METRICS.map((m) => `
      <div class="metric"><div class="metric-head"><b>${m.ic} ${m.name}</b><span>${label(s[m.key])} · <em>${s[m.key]}</em></span></div>
      <div class="bar-bg" role="progressbar" aria-label="${m.name} 점수" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s[m.key]}"><div class="bar-fg" data-w="${s[m.key]}" style="background:${barColor(s[m.key])}"></div></div><small>${m.desc}</small></div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll('.bar-fg').forEach((b) => (b.style.width = b.dataset.w + '%'))));
    // 팁: 점수가 낮은 순
    const weak = METRICS.filter((m) => s[m.key] < 72).sort((a, b) => s[a.key] - s[b.key]);
    const tipKeys = weak.length ? weak.map((m) => m.key) : ['good'];
    $('#tips').innerHTML = tipKeys.map((k) => `<div class="tip"><span class="ic">${TIPS[k].ic}</span><div><b>${TIPS[k].t}</b><p>${TIPS[k].p}</p></div></div>`).join('');
    // 시각화
    setViz('heat');
    // 비교
    const hist = loadHistory();
    const prev = hist[0];
    const d = $('#res-delta');
    if (prev) {
      const diff = s.overall - prev.scores.overall;
      d.hidden = false;
      d.className = 'delta ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '');
      d.textContent = `지난 측정(${fmtDate(prev.ts)}) 대비 ${diff > 0 ? '▲ ' + diff : diff < 0 ? '▼ ' + -diff : '변화 없음'}${diff ? '점' : ''}`;
    } else d.hidden = true;
    renderHistory('#history-card', '#trend-canvas', '#history-list', hist, s.overall);
    $('#btn-save').textContent = '기록 저장하기'; $('#btn-save').disabled = false;
  }
  const LEGEND = {
    heat: '민트색은 매끈한 부분, 노랑→코랄로 갈수록 표면 요철이 많은 부분이에요.',
    pores: '원으로 표시된 부분이 모공으로 추정되는 어두운 점이에요. (빨강: 더 뚜렷함)',
    lines: '분홍색으로 표시된 부분이 선 형태의 결(잔주름)로 감지된 영역이에요.',
    original: '분석에 사용된 가이드 영역 원본이에요.',
  };
  function setViz(mode) {
    document.querySelectorAll('#viz-tabs button').forEach((b) => { b.classList.toggle('on', b.dataset.mode === mode); b.setAttribute('aria-pressed', b.dataset.mode === mode); });
    const ctx = $('#viz-canvas').getContext('2d');
    SA.renderOverlay(ctx, current.canvas, current.result.viz, mode);
    let leg = LEGEND[mode];
    if (mode === 'pores') leg += ` 감지: ${current.result.viz.pores.length}개`;
    $('#viz-legend').textContent = leg;
  }

  // ---------- 기록 ----------
  function loadHistory() { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch (e) { return []; } }
  function saveHistory(h) { try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 40))); return true; } catch (e) { return false; } }
  function thumbOf(canvas) { const c = document.createElement('canvas'); c.width = c.height = 96; c.getContext('2d').drawImage(canvas, 0, 0, 96, 96); return c.toDataURL('image/jpeg', 0.7); }
  function saveCurrent() {
    if (!current) return;
    if (current.result.invalid) return toast('측정이 완료되지 않은 결과는 저장할 수 없어요');
    if (current.saved) return toast('이미 저장된 결과예요');
    const h = loadHistory();
    h.unshift({ ts: current.ts, scores: current.result.scores, grade: current.result.grade.key, thumb: thumbOf(current.canvas) });
    if (saveHistory(h)) { current.saved = true; toast('기록이 저장됐어요. 다음 측정 때 비교해 드릴게요!'); $('#btn-save').textContent = '저장 완료 ✓'; $('#btn-save').disabled = true; }
    else toast('저장 공간이 부족해요');
    renderHistory('#history-card', '#trend-canvas', '#history-list', loadHistory());
  }
  function renderHistory(cardSel, canvasSel, listSel, hist, pendingScore) {
    const card = cardSel ? $(cardSel) : null;
    const points = hist.slice(0, 10).reverse().map((x) => ({ v: x.scores.overall, ts: x.ts }));
    if (pendingScore != null && !(current && current.saved)) points.push({ v: pendingScore, ts: Date.now(), pending: true });
    if (card) card.hidden = points.length < 2;
    drawTrend($(canvasSel), points);
    const list = $(listSel);
    list.innerHTML = hist.length ? hist.slice(0, 12).map((x) => `<div class="h-item"><img src="${x.thumb}" alt=""><div class="info"><b>${fmtDate(x.ts)}</b>매끄러움 ${x.scores.smooth} · 모공 ${x.scores.pore} · 잔주름 ${x.scores.lines}</div><span class="sc">${x.scores.overall}</span></div>`).join('') : '<p class="empty">아직 저장된 기록이 없어요</p>';
  }
  function drawTrend(cv, pts) {
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const pl = 40, pr = 20, pt = 20, pb = 34;
    ctx.font = '20px Pretendard, sans-serif'; ctx.fillStyle = '#b3a39c'; ctx.strokeStyle = '#f0e3dc'; ctx.lineWidth = 1.5;
    for (const g of [0, 50, 100]) { const y = pt + (H - pt - pb) * (1 - g / 100); ctx.beginPath(); ctx.moveTo(pl, y); ctx.lineTo(W - pr, y); ctx.stroke(); ctx.fillText(g, 4, y + 7); }
    if (!pts.length) return;
    const xs = (i) => pts.length === 1 ? (pl + W - pr) / 2 : pl + 10 + (W - pl - pr - 20) * i / (pts.length - 1);
    const ys = (v) => pt + (H - pt - pb) * (1 - v / 100);
    ctx.strokeStyle = '#d58b84'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(xs(i), ys(p.v)) : ctx.moveTo(xs(i), ys(p.v)))); ctx.stroke();
    pts.forEach((p, i) => {
      ctx.fillStyle = p.pending ? '#fff' : '#d58b84'; ctx.strokeStyle = '#d58b84'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(xs(i), ys(p.v), 7, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3b2f2c'; ctx.font = 'bold 20px Pretendard, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(p.v, xs(i), ys(p.v) - 14);
      ctx.fillStyle = '#b3a39c'; ctx.font = '17px Pretendard, sans-serif';
      const d = new Date(p.ts); ctx.fillText(p.pending ? '지금' : `${d.getMonth() + 1}/${d.getDate()}`, xs(i), H - 8);
      ctx.textAlign = 'left';
    });
  }

  // ---------- 결과 이미지 ----------
  function buildShareImage() {
    const { result, canvas, ts } = current, s = result.scores;
    const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#fbeee7'); g.addColorStop(1, '#f6e2d8'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    const F = 'Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif';
    x.textAlign = 'center'; if (LOGO.complete && LOGO.naturalWidth) x.drawImage(LOGO, W / 2 - 96, 52, 192, 60); else { x.fillStyle = '#3b2f2c'; x.font = `600 40px ${F}`; x.fillText('H.O.W', W / 2, 95); }
    x.fillStyle = '#3b2f2c'; x.font = `800 64px ${F}`; x.fillText('나의 피부결 리포트', W / 2, 175);
    x.fillStyle = '#8a7a74'; x.font = `400 30px ${F}`; const d = new Date(ts); x.fillText(`${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`, W / 2, 225);
    // 사진
    x.save(); rr(x, 90, 280, 420, 420, 40); x.clip(); x.drawImage(canvas, 90, 280, 420, 420); x.restore();
    // 점수
    x.fillStyle = '#fffdfb'; rr(x, 560, 280, 430, 420, 40); x.fill();
    x.fillStyle = '#8a7a74'; x.font = `500 32px ${F}`; x.fillText('피부결 점수', 775, 360);
    x.fillStyle = '#3b2f2c'; x.font = `800 170px ${F}`; x.fillText(s.overall, 775, 530);
    x.fillStyle = '#d58b84'; x.font = `700 44px ${F}`; x.fillText(`${result.grade.key} · ${result.grade.label}`, 775, 620);
    // 바
    x.textAlign = 'left';
    METRICS.forEach((m, i) => {
      const y = 800 + i * 130, v = s[m.key];
      x.fillStyle = '#3b2f2c'; x.font = `700 38px ${F}`; x.fillText(m.name, 90, y);
      x.textAlign = 'right'; x.fillText(v, 990, y); x.textAlign = 'left';
      x.fillStyle = '#f0ddd4'; rr(x, 90, y + 25, 900, 26, 13); x.fill();
      x.fillStyle = v >= 75 ? '#5fb8a2' : v >= 55 ? '#d9a95b' : '#e8765f'; rr(x, 90, y + 25, Math.max(26, 900 * v / 100), 26, 13); x.fill();
    });
    x.textAlign = 'center'; x.fillStyle = '#a3938c'; x.font = `400 24px ${F}`;
    x.fillText('※ 의학적 진단이 아닌 참고용 결과이며, 조명·촬영 조건에 따라 달라질 수 있어요', W / 2, H - 70);
    return c;
  }
  const LOGO = new Image(); LOGO.src = 'logo.svg';
  function rr(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
  let sharing = false;
  async function shareResult() {
    if (!current || sharing || current.result.invalid) return;
    sharing = true;
    try { await doShare(); } finally { setTimeout(() => (sharing = false), 600); }
  }
  async function doShare() {
    const c = buildShareImage();
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], `HOW_피부결_${current.result.scores.overall}점.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'H.O.W 피부결 리포트', text: `H.O.W 피부결 테스터 — 내 피부결 점수는 ${current.result.scores.overall}점!` }); return; }
      catch (e) { if (e.name === 'AbortError' || e.name === 'InvalidStateError') return; }
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = href; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 30000);
    toast('결과 이미지를 저장했어요');
  }

  // ---------- 이벤트 ----------
  $('#btn-start').onclick = startCamera;
  $('#btn-shutter').onclick = captureFromVideo;
  $('#btn-flip').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; startCamera(); };
  $('#btn-torch').onclick = async () => {
    const t = stream && stream.getVideoTracks()[0]; if (!t) return;
    torchOn = !torchOn; try { await t.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch (e) { torchOn = false; toast('조명을 켤 수 없어요'); }
  };
  $('#btn-cam-close').onclick = $('#btn-cam-back').onclick = () => { stopCamera(); show('intro'); };
  ['#file-input', '#file-input2', '#file-input3'].forEach((id) => { const el = $(id); if (el) el.onchange = onFile; });
  $('#btn-copy-link').onclick = copyLink;
  $('#btn-cam-retry').onclick = startCamera;
  $('#tap-to-play').onclick = () => { const v = $('#video'); v.play().then(() => ($('#tap-to-play').hidden = true)).catch(() => camError('unknown')); };
  setupInappBanner();
  // 안드로이드 뒤로가기: 앱을 닫지 않고 처음 화면으로
  window.addEventListener('popstate', () => {
    const onIntro = $('#screen-intro').classList.contains('active');
    if (show._expectPop) { show._expectPop = false; if (!onIntro) try { history.pushState({ app: 1 }, ''); } catch (e) {} return; }
    if (!onIntro) { stopCamera(); show._pop = true; show('intro'); }
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update && r.update()).catch(() => {}));
  $('#btn-res-home').onclick = () => show('intro');
  $('#btn-retry').onclick = startCamera;
  $('#btn-invalid-retry').onclick = startCamera;
  $('#btn-save').onclick = saveCurrent;
  $('#btn-share').onclick = shareResult;
  $('#viz-tabs').onclick = (e) => { const m = e.target.dataset && e.target.dataset.mode; if (m) setViz(m); };
  $('#btn-history').onclick = () => { show('history'); renderHistory(null, '#trend-canvas2', '#history-list2', loadHistory()); };
  $('#btn-hist-home').onclick = () => show('intro');
  $('#btn-clear').onclick = () => { if (confirm('모든 측정 기록을 삭제할까요?')) { localStorage.removeItem(HKEY); renderHistory(null, '#trend-canvas2', '#history-list2', []); toast('기록을 삭제했어요'); } };
  window.addEventListener('resize', () => stream && layoutGuide());
  document.addEventListener('visibilitychange', () => { if (document.hidden && stream) stopCamera(), show('intro'); });

  // 테스트용 훅 (자동 테스트에서만 사용)
  window.__skinTest = {
    async analyzeUrl(url, fast = true) { const im = await loadImage(url); const r = await runAnalysis(await fromImage(im), fast); return { scores: r.scores, raw: r.raw, warnings: r.warnings, pores: r.viz.pores.length }; },
    save: saveCurrent,
  };
})();
