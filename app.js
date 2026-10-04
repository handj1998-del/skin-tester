(function () {
  'use strict';
  // ===== 버전: 단일 기준값 (sw.js 캐시 이름도 이 값을 사용, version.json과 함께 갱신) =====
  const APP_VERSION = '1.6.0';
  const BUILD_DATE = '2026-10-04';
  window.APP_VERSION = APP_VERSION;
  (function () { try { var f = document.createElement('div'); f.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden'; f.appendChild(document.createElement('div')); f.appendChild(document.createElement('div')); document.body.appendChild(f); var ok = f.scrollHeight === 1; f.remove(); if (!ok) document.documentElement.classList.add('no-flexgap'); } catch (e) {} })();
  const $ = (s) => document.querySelector(s);
  const SA = window.SkinAnalyzer;
  const GUIDE_FRAC = 0.62;     // 화면 짧은 변 대비 가이드 크기
  const UPLOAD_FRAC = 0.7;     // 업로드 사진 중앙 크롭 비율

  let stream = null, facing = 'environment', meterTimer = null, torchOn = false;
  let reportName = '', reportPages = null, reportP = null, reportBusy = false, reportTimer = 0; // 리포트 (메모리에만)
  let current = null; // {result, canvas, ts} — 메모리에만, 화면을 벗어나면 삭제
  // 공용(매장) 기기: 이전 버전이 남긴 기록·썸네일·설정을 시작할 때 모두 삭제하고, 이후에도 아무것도 저장하지 않음
  (function wipeStored() {
    try { const ks = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^(skinTexture\.|how\.)/.test(k)) ks.push(k); } ks.forEach((k) => localStorage.removeItem(k)); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
  })();

  // ---------- 화면 전환 ----------
  function show(id) {
    try {
      if (id !== 'intro' && !(history.state && history.state.app)) history.pushState({ app: 1 }, '');
      else if (id === 'intro' && history.state && history.state.app && !show._pop && !show._expectPop) { show._expectPop = true; history.back(); } // 연타 시 앱 밖으로 나가지 않게 한 번만
    } catch (e) {}
    show._pop = false;
    if (id === 'intro') wipeSession();
    document.querySelectorAll('.screen').forEach((s) => { const on = s.id === 'screen-' + id; s.classList.toggle('active', on); s.setAttribute('aria-hidden', on ? 'false' : 'true'); });
    window.scrollTo(0, 0);
    try { armIdle(); updateDock(); if (id === 'analyzing') armWatchdog(); if (id === 'intro') applyIntroMode(); if (id !== 'staff' && id !== 'staff-pin') staffUnlocked = false; if (id !== 'report') restorePrint(); } catch (e) {} // 초기화 전 호출 무시
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
    const tips = $('#cam-tips'); if (tips) { tips.classList.add('show'); clearTimeout(startCamera._tipT); startCamera._tipT = setTimeout(() => tips.classList.remove('show'), 4000); }
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
    const fb = $('#cam-error label.btn'); if (fb) fb.htmlFor = faceMode ? 'face-file' : zonesMode ? 'file-input2' : 'file-input';
    $('#cam-error').dataset.code = code;
    $('#cam-error').hidden = false;
  }
  function hideCamError() { $('#cam-error').hidden = true; }
  function stopCamera() {
    clearInterval(meterTimer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; torchOn = false;
    try { resetLight(); } catch (e) {}
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
    // 화면 전체 밝기 (역광 판단: 주변은 밝은데 가운데가 어두움)
    x.drawImage(v, 0, 0, v.videoWidth, v.videoHeight, 0, 0, 48, 48);
    const fd = x.getImageData(0, 0, 48, 48).data; let fs = 0;
    for (let i = 0; i < fd.length; i += 4) fs += 0.299 * fd[i] + 0.587 * fd[i + 1] + 0.114 * fd[i + 2];
    const fm = fs / (fd.length / 4);
    let st = 'ok';
    if (m < 70) { txt = '조금 더 밝은 곳으로'; ok = false; st = 'dark'; }
    else if (m > 215 || clip > 120) { txt = '빛이 너무 강해요'; ok = false; st = 'bright'; }
    else if (fm > 150 && m < fm * 0.62) { txt = '역광이에요'; ok = false; st = 'backlit'; }
    if (lightOverride) { st = lightOverride; ok = st === 'ok'; txt = ok ? '밝기 좋음' : LIGHT_MSG[st][0]; }
    lightVerdict(st);
    el.classList.toggle('good', ok); el.classList.toggle('bad', !ok);
    $('#light-text').textContent = txt;
    $('#cam-guide').classList.toggle('ok', ok);
  }
  let busy = false;
  function captureFromVideo() {
    if (busy || activeId() !== 'camera') return;
    if (lightState !== 'ok' && !shootConfirmed && stream) return askShootConfirm(); // 어두움/역광: 확인 후 촬영
    shootConfirmed = false;
    if (faceMode) return captureFace();
    if (zonesMode) return captureZone();
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
    const id = e.target.id;
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f || busy) return;
    if (f.type && !/^image\//.test(f.type)) return toast('이미지 파일만 분석할 수 있어요');
    const toFace = id === 'face-file' || (id === 'file-input2' && faceMode);
    const toZone = id === 'file-input2' && zonesMode && !faceMode;
    if (!toFace && !toZone) { exitFaceMode(); exitZonesMode(); zoneSession = null; }
    stopCamera();
    const url = URL.createObjectURL(f);
    try { const im = await loadImage(url); if (toFace) runFace(fromFaceImage(im)); else if (toZone) runZone(await fromImage(im)); else runAnalysis(await fromImage(im)); }
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
    $('#analyze-title').textContent = '피부결을 분석하고 있어요'; $('#analyze-dl').hidden = true;
    const sc = $('#scan-canvas'); sc.getContext('2d').drawImage(canvas, 0, 0, sc.width, sc.height);
    const steps = ['조명 보정 중…', '피부 표면 거칠기 측정 중…', '모공 패턴 찾는 중…', '잔주름 방향성 분석 중…'];
    const data = canvas.getContext('2d').getImageData(0, 0, SA.WORK, SA.WORK).data;
    const result = SA.analyzeRGBA(data, SA.WORK);
    if (!fast) for (const s of steps) { $('#analyze-step').textContent = s; await sleep(480); }
    wipeSession(); current = { result, canvas, ts: Date.now() };
    renderResult();
    return result;
  }

  // ---------- 결과 ----------
  const METRICS = [
    { key: 'smooth', name: '매끄러움', en: 'Smoothness', desc: '표면 요철·거칠기가 적을수록 높아요' },
    { key: 'pore', name: '모공', en: 'Pores', desc: '눈에 띄는 모공(어두운 점)이 적을수록 높아요' },
    { key: 'lines', name: '잔주름', en: 'Fine lines', desc: '가는 선 형태의 결 꺾임이 적을수록 높아요' },
  ];
  const TIPS = {
    smooth: { ic: '01', t: '매끄러움 케어', p: '주 1~2회 저자극 각질 케어(PHA·LHA 등)로 묵은 각질을 정돈하고, 세라마이드·판테놀 보습제로 장벽을 채워주세요. 뜨거운 물 세안은 피해주세요.' },
    pore: { ic: '02', t: '모공 케어', p: '저녁엔 약산성 클렌저로 꼼꼼히 세안하고, BHA(살리실산)·나이아신아마이드 제품을 꾸준히 사용해 보세요. 피지가 많은 날은 유분 조절 토너가 도움돼요.' },
    lines: { ic: '03', t: '잔주름 케어', p: '건조로 생기는 잔주름은 수분 공급이 우선! 히알루론산 세럼 + 크림으로 수분을 잠그고, 낮에는 자외선 차단제를 꼭 덧발라 주세요. 레티놀은 저농도부터 천천히.' },
    good: { ic: '—', t: '지금처럼 유지해요', p: '좋은 피부결이에요. 충분한 수면과 수분 섭취, 매일 자외선 차단을 지켜주세요. 같은 조건으로 주 1회 측정하면 변화를 확인할 수 있어요.' },
  };
  const TONE = { good: '#5f7d72', mid: '#a58a55', low: '#a3604f', ink: '#2b2523', acc: '#a9796d' };
  function toneOf(s) { return s >= 75 ? TONE.good : s >= 55 ? TONE.mid : TONE.low; }
  function barColor(s) { return toneOf(s); }
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
    bar.style.stroke = TONE.ink;
    bar.style.strokeDashoffset = 326.7;
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.strokeDashoffset = 326.7 * (1 - s.overall / 100); }));
    // 경고
    const w = $('#res-warn');
    w.hidden = !result.warnings.length;
    w.innerHTML = '<b class="warn-title">촬영 참고</b>' + result.warnings.map((x) => `<p>${x}</p>`).join('');
    // 항목
    $('#metrics').innerHTML = METRICS.map((m) => `
      <div class="metric"><div class="metric-head"><b>${m.name}<i>${m.en}</i></b><span>${label(s[m.key])} · <em>${s[m.key]}</em></span></div>
      <div class="bar-bg" role="progressbar" aria-label="${m.name} 점수" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s[m.key]}"><div class="bar-fg" data-w="${s[m.key]}" style="background:${barColor(s[m.key])}"></div></div><small>${m.desc}</small></div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll('.bar-fg').forEach((b) => (b.style.width = b.dataset.w + '%'))));
    // 팁: 점수가 낮은 순
    const weak = METRICS.filter((m) => s[m.key] < 72).sort((a, b) => s[a.key] - s[b.key]);
    const tipKeys = weak.length ? weak.map((m) => m.key) : ['good'];
    moveRecCard(false);
    renderRecs();
    // 시각화
    setViz('heat');
  }
  // ---------- 맞춤 추천 (케어 · 메이크업 · 컬러) ----------
  const REC = window.HowRecommend;
  let recTab = 'care';
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let seasonChoice = 'auto'; // 측정마다 초기화 (저장하지 않음)
  function getSeasonChoice() { return seasonChoice; }
  function setSeasonChoice(v) { seasonChoice = v; }
  function currentSeason() {
    const ch = getSeasonChoice();
    return ch !== 'auto' && REC.SEASONS[ch] ? ch : current.tone.season;
  }
  function list(items, ordered) { const t = ordered ? 'ol' : 'ul'; return `<${t} class="rec-list">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</${t}>`; }
  function swatches(arr, cls = '') { return `<div class="sw-row ${cls}">${arr.map(([n, hex]) => `<div class="sw"><span class="dot" style="background:${hex}" aria-hidden="true"></span><small>${esc(n)}</small></div>`).join('')}</div>`; }
  function renderRecs() {
    if (current.mode === 'zones') {
      const Z = current.zones;
      current.care = REC.buildZoneCare(Z.agg, Z.ok.map((z) => ({ name: z.name, scores: z.scores, redLevel: z.redLevel, shineLevel: z.shineLevel })), Z.fi);
      current.makeup = REC.buildZoneMakeup(Z.agg, Z.fi);
      current.skinRGB = Z.skinRGB; current.tone = REC.estimateTone(Z.skinRGB, Z.warnings);
    } else if (current.mode === 'face') {
      const fi = faceRecInput(current.face);
      current.care = REC.buildFaceCare(fi); current.makeup = REC.buildFaceMakeup(fi);
      current.skinRGB = current.face.skinRGB; current.tone = REC.estimateTone(current.skinRGB, current.face.warnings);
    } else {
      const r = current.result;
      current.care = REC.buildCare(r.scores); current.makeup = REC.buildMakeup(r.scores);
      current.skinRGB = r.raw.rgb; current.tone = REC.estimateTone(r.raw.rgb, r.warnings);
    }
    const c = current.care, m = current.makeup;
    $('#panel-care').innerHTML = `
      <div class="rec-hero"><span class="rec-label">집중 영역</span><b>${esc(c.priorityName)}</b><p>${esc(c.headline)}</p></div>
      ${c.zoneTips && c.zoneTips.length ? `<h4><span class="kicker">By zone</span>부위별 포인트</h4>${list(c.zoneTips)}` : ''}
      <div class="rec-split">
        <div><h4><span class="kicker">AM</span>아침</h4>${list(c.am, true)}</div>
        <div><h4><span class="kicker">PM</span>저녁</h4>${list(c.pm, true)}</div>
      </div>
      <h4><span class="kicker">Ingredients</span>찾아볼 성분</h4>
      <dl class="ing">${c.ingredients.map(([n, d]) => `<div><dt>${esc(n)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>
      <h4><span class="kicker">Weekly</span>주간 스페셜 케어</h4>${list(c.weekly)}
      <h4><span class="kicker">Avoid</span>피하면 좋은 습관</h4>${list(c.avoid)}
      <p class="rec-note">일반적인 화장품 사용 가이드예요. 자극·붉은기가 생기면 사용을 멈추고, 피부 질환이 의심되면 전문의와 상담하세요.</p>`;
    $('#panel-makeup').innerHTML = `
      <div class="rec-hero"><span class="rec-label">추천 베이스 마무리</span><b>${esc(m.finish)}</b><p>${esc(m.finishWhy)}</p></div>
      <h4><span class="kicker">Primer</span>프라이머</h4><p class="rec-p">${esc(m.primer)}</p>
      <h4><span class="kicker">How to</span>바르는 방법</h4>${list(m.tips, true)}
      <p class="rec-note">결과에 따른 일반적인 연출 팁이에요. 피부 타입과 사용 제품에 맞게 조절해 주세요.</p>`;
    renderColor();
    selectRecTab(recTab, false);
  }
  function renderColor() {
    const t = current.tone, choice = getSeasonChoice(), key = currentSeason(), S = REC.SEASONS[key], E = REC.SEASONS[t.season];
    const skin = current.skinRGB.map((v) => Math.round(v));
    const conf = t.confidence === 'low' ? '낮음' : '보통';
    const opts = [['auto', '모름 (추정 사용)'], ['spring', '봄 웜'], ['summer', '여름 쿨'], ['autumn', '가을 웜'], ['winter', '겨울 쿨']];
    $('#panel-color').innerHTML = `
      <div class="tone-est">
        <span class="skin-dot" style="background:rgb(${skin.join(',')})" aria-hidden="true"></span>
        <div><span class="rec-label">${current.mode === 'face' ? '얼굴 피부색 기반 추정' : current.mode === 'zones' ? '부위 사진 피부색 기반 추정' : '사진 기반 추정'}</span><b>${t.undertone === 'warm' ? '웜' : '쿨'} 톤 · ${esc(E.name)}</b>
        <p>신뢰도 ${conf}${t.neutral ? ' · 뉴트럴에 가까워요' : ''}. 조명과 카메라 화이트밸런스의 영향을 크게 받는 참고값이에요. 알고 있는 퍼스널컬러가 있다면 아래에서 선택해 주세요.</p></div>
      </div>
      <div class="season-pick" role="radiogroup" aria-label="퍼스널컬러 선택">
        ${opts.map(([v, n]) => `<button type="button" role="radio" aria-checked="${choice === v}" data-season="${v}" class="${choice === v ? 'on' : ''}">${n}</button>`).join('')}
      </div>
      <div class="season-head"><span class="kicker">${esc(S.en)}</span><b>${esc(S.name)}</b>${choice === 'auto' ? '<em>추정</em>' : '<em>선택</em>'}<p>${esc(S.desc)}</p></div>
      <h4>파운데이션 언더톤</h4>${swatches(S.foundation, 'lg')}
      <h4>립</h4>${swatches(S.lip)}
      <h4>블러셔</h4>${swatches(S.blush)}
      <h4>아이섀도</h4>${swatches(S.eye)}
      <h4>피하면 좋은 컬러</h4>${swatches(S.avoid, 'avoid')}
      <p class="rec-note">퍼스널컬러는 자연광에서 전문가 진단으로 확인하는 것이 가장 정확해요. 화면 색상은 기기에 따라 다르게 보일 수 있어요.</p>`;
    $('#panel-color').querySelectorAll('[data-season]').forEach((b) => (b.onclick = () => { setSeasonChoice(b.dataset.season); renderColor(); const nb = $('#panel-color').querySelector(`[data-season="${b.dataset.season}"]`); if (nb) nb.focus(); }));
  }
  function selectRecTab(tab, focus) {
    recTab = tab;
    document.querySelectorAll('.rec-tabs [role=tab]').forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; b.classList.toggle('on', on); if (on && focus) b.focus(); });
    ['care', 'makeup', 'color'].forEach((k) => ($('#panel-' + k).hidden = k !== tab));
  }
  document.querySelector('.rec-tabs').addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (b) selectRecTab(b.dataset.tab, false); });
  document.querySelector('.rec-tabs').addEventListener('keydown', (e) => {
    const order = ['care', 'makeup', 'color'], i = order.indexOf(recTab);
    if (e.key === 'ArrowRight') { selectRecTab(order[(i + 1) % 3], true); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { selectRecTab(order[(i + 2) % 3], true); e.preventDefault(); }
  });

  const LEGEND = {
    heat: '세이지색은 매끈한 부분, 샌드→테라코타로 갈수록 표면 요철이 많은 부분이에요.',
    pores: '원으로 표시된 부분이 모공으로 추정되는 어두운 점이에요. (진한 갈색: 더 뚜렷함)',
    lines: '자주색으로 표시된 부분이 선 형태의 결(잔주름)로 감지된 영역이에요.',
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

  // ---------- 세션 초기화 (다음 고객) ----------
  function freeCanvas(c) { if (c && c.getContext) { c.width = 0; c.height = 0; } }
  function wipeSession() {
    if (current) { // 이전 고객의 큰 캔버스 메모리를 바로 반환
      freeCanvas(current.canvas);
      if (current.zones) { current.zones.zones.forEach((z) => freeCanvas(z.canvas)); freeCanvas(current.zones.faceCanvas); }
    }
    current = null; seasonChoice = 'auto'; recTab = 'care';
    if (typeof resetReport === 'function') resetReport();
    zoneSession = null; zonesMode = false; const zb = $('#btn-face-zskip'); if (zb) zb.hidden = true;
    ['#viz-canvas', '#invalid-thumb', '#face-map', '#face-invalid-thumb', '#scan-canvas', '#zr-map', '#zr-face-map', '#zs-thumb'].forEach((sel) => { const c = $(sel); if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height); });
    ['#panel-care', '#panel-makeup', '#panel-color', '#metrics', '#face-zones', '#face-tu', '#zr-list', '#zr-tu', '#zr-best', '#zs-metrics', '#zs-reasons'].forEach((sel) => { const el = $(sel); if (el) el.innerHTML = ''; });
  }
  function nextCustomer() { stopCamera(); exitFaceMode(); exitZonesMode(); if (typeof stopIdle === 'function') stopIdle(); show('intro'); window.scrollTo(0, 0); if (pendingUpdate && !refreshing) hardRefresh(); }

  // ---------- 결과 이미지 ----------
  function buildShareImage() {
    const { result, canvas, ts } = current, s = result.scores;
    const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#f6f2ee'; x.fillRect(0, 0, W, H);
    const F = 'Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif';
    const SERIF = '"Cormorant Garamond", Georgia, "Times New Roman", serif';
    const INK = '#2b2523', SUB = '#6f6560', ACC = '#a9796d', LINE = 'rgba(43,37,35,.14)';
    // 테두리 프레임
    x.strokeStyle = LINE; x.lineWidth = 2; x.strokeRect(48, 48, W - 96, H - 96);
    x.textAlign = 'center';
    if (LOGO.complete && LOGO.naturalWidth) { const lw = 250, lh = lw * LOGO.naturalHeight / LOGO.naturalWidth; x.drawImage(LOGO, W / 2 - lw / 2, 120, lw, lh); }
    else { x.fillStyle = INK; x.font = `600 72px ${F}`; x.fillText('H.O.W', W / 2, 185); }
    x.fillStyle = SUB; x.font = `500 26px ${F}`; spaced(x, '피부결 리포트', W / 2, 262, 8);
    const d = new Date(ts); x.font = `400 30px ${SERIF}`; x.fillStyle = SUB; x.fillText(`${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`, W / 2, 308);
    x.fillStyle = ACC; x.fillRect(W / 2 - 24, 340, 48, 2);
    // 사진 + 점수
    const py = 400, ps = 400;
    x.drawImage(canvas, 120, py, ps, ps); x.strokeStyle = LINE; x.strokeRect(120, py, ps, ps);
    x.fillStyle = SUB; x.font = `500 26px ${F}`; spaced(x, '피부결 점수', 790, py + 70, 4);
    x.fillStyle = INK; x.font = `300 220px ${SERIF}`; x.fillText(String(s.overall), 790, py + 285);
    x.fillStyle = ACC; x.fillRect(790 - 60, py + 318, 120, 1.5);
    x.fillStyle = INK; x.font = `500 34px ${F}`; x.fillText(`${result.grade.key} · ${result.grade.label}`, 790, py + 375);
    // 항목
    x.textAlign = 'left';
    METRICS.forEach((m, i) => {
      const y = 920 + i * 110, v = s[m.key];
      x.fillStyle = INK; x.font = `500 32px ${F}`; x.fillText(m.name, 120, y); const nw = x.measureText(m.name).width;
      x.fillStyle = SUB; x.font = `400 28px ${SERIF}`; x.fillText(m.en, 120 + nw + 18, y);
      x.textAlign = 'right'; x.fillStyle = INK; x.font = `400 44px ${SERIF}`; x.fillText(String(v), 960, y + 2); x.textAlign = 'left';
      x.fillStyle = 'rgba(43,37,35,.10)'; x.fillRect(120, y + 26, 840, 3);
      x.fillStyle = toneOf(v); x.fillRect(120, y + 26, Math.max(6, 840 * v / 100), 3);
    });
    if (current.care && current.tone) {
      const sn = REC.SEASONS[currentSeason()].name + (getSeasonChoice() === 'auto' ? ' (추정)' : '');
      x.textAlign = 'center'; x.fillStyle = INK; x.font = `500 26px ${F}`;
      x.fillText(`${sn}   ·   ${current.care.mode === 'maintain' ? '컨디션 유지 관리' : '집중 케어 ' + current.care.priorityName}`, W / 2, 1222);
    }
    x.textAlign = 'center'; x.fillStyle = '#8b807a'; x.font = `400 22px ${F}`;
    x.fillText('의학적 진단이 아닌 참고용 결과이며, 조명·촬영 조건에 따라 달라질 수 있어요', W / 2, H - 92);
    return c;
  }
  function spaced(x, text, cx, y, sp) {
    const chars = [...text], widths = chars.map((ch) => x.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
    const al = x.textAlign; x.textAlign = 'left';
    let px = cx - total / 2; chars.forEach((ch, i) => { x.fillText(ch, px, y); px += widths[i] + sp; });
    x.textAlign = al;
  }
  const LOGO = new Image(); LOGO.src = 'logo.svg?v=' + APP_VERSION;
  function rr(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
  let sharing = false;
  async function shareResult() {
    if (!current || sharing || (current.mode === 'face' ? current.face.invalid : current.result.invalid)) return;
    sharing = true;
    const sb = $(current.mode === 'face' ? '#btn-face-share' : '#btn-share'); const label = sb.textContent;
    sb.setAttribute('aria-busy', 'true'); sb.textContent = '이미지 만드는 중…';
    try { await doShare(); } finally { sb.textContent = label; sb.removeAttribute('aria-busy'); setTimeout(() => (sharing = false), 600); }
  }
  async function doShare() {
    try { await Promise.all([document.fonts.load('300 220px "Cormorant Garamond"'), document.fonts.load('400 28px "Cormorant Garamond"')]); } catch (e) {}
    const isFace = current.mode === 'face';
    const c = isFace ? buildFaceShareImage() : buildShareImage();
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], isFace ? `HOW_얼굴분석_${fmtDate(current.ts).replace(/[ :.]/g, '')}.png` : `HOW_피부결_${current.result.scores.overall}점.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: isFace ? 'H.O.W 얼굴 피부 리포트' : 'H.O.W 피부결 리포트', text: isFace ? `H.O.W 얼굴 전체 분석 — ${current.face.type.name}` : `H.O.W 피부결 테스터 — 내 피부결 점수는 ${current.result.scores.overall}점!` }); return; }
      catch (e) { if (e.name === 'AbortError' || e.name === 'InvalidStateError') return; }
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = href; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 30000);
    toast('결과 이미지를 저장했어요');
  }

  // ---------- 얼굴 전체 분석 (선택 모드 · MediaPipe Face Landmarker, 기기 안에서 실행) ----------
  const FACE_VER = 'mp101';
  const FACE_BYTES = 11756954 + 3758596; // wasm + model (압축 해제 기준)
  const LV = ['낮음', '보통', '높음'];
  let faceMode = false, faceTools = null, faceLoadP = null, faceProg = 0, faceLayer = 'red';
  const faceListeners = [];
  function faceSupported() {
    try {
      if (typeof WebAssembly !== 'object' || typeof WebAssembly.validate !== 'function') return false;
      // WebAssembly SIMD (MediaPipe 런타임 요구)
      if (!WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]))) return false;
      if (!('noModule' in HTMLScriptElement.prototype) || !window.fetch || !window.ReadableStream || !window.Blob || !window.URL || !URL.createObjectURL) return false;
      // 최신 문법(대략 Chrome 94+ / Safari 16.4+) — 문자열로만 검사하므로 구형 브라우저에서도 이 파일은 정상 파싱됨
      new Function('class A { static #p = 1; static { A.q = A.#p; } } let o = null; o?.x; let v; v ??= 1; return 1_0;');
      return true;
    } catch (e) { return false; }
  }
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('script ' + src)); document.head.appendChild(s); });
  }
  async function fetchBytes(url, onChunk) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('http ' + res.status + ' ' + url);
    if (!res.body || !res.body.getReader) { const b = new Uint8Array(await res.arrayBuffer()); onChunk(b.length); return b; }
    const rd = res.body.getReader(), parts = []; let n = 0;
    for (;;) { const r = await rd.read(); if (r.done) break; parts.push(r.value); n += r.value.length; onChunk(r.value.length); }
    const out = new Uint8Array(n); let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  }
  function loadFaceTools() {
    if (faceTools) return Promise.resolve(faceTools);
    if (faceLoadP) return faceLoadP;
    let got = 0;
    const tick = (n) => { got += n; faceProg = Math.min(0.99, got / FACE_BYTES); faceListeners.forEach((f) => f(faceProg)); };
    faceLoadP = (async () => {
      if (!window.HowFaceAnalyze) await loadScript('face/face-analyze.js?v=' + APP_VERSION);
      const libP = new Promise((res, rej) => {
        if (window.HowFaceLib) return res();
        window.addEventListener('howface-lib', () => res(), { once: true });
        const s = document.createElement('script'); s.type = 'module'; s.src = 'face/face.js?v=' + APP_VERSION;
        s.onerror = () => rej(new Error('module load failed')); document.head.appendChild(s);
        setTimeout(() => rej(new Error('module timeout')), 90000);
      });
      const bytes = await Promise.all([fetchBytes('face/vision_wasm_internal.wasm?v=' + FACE_VER, tick), fetchBytes('face/face_landmarker.task?v=' + FACE_VER, tick)]);
      await libP;
      const wasmUrl = URL.createObjectURL(new Blob([bytes[0]], { type: 'application/wasm' }));
      try {
        const lm = await window.HowFaceLib.FaceLandmarker.createFromOptions(
          { wasmLoaderPath: new URL('face/vision_wasm_internal.js?v=' + FACE_VER, location.href).href, wasmBinaryPath: wasmUrl },
          { baseOptions: { modelAssetBuffer: bytes[1], delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 2 });
        faceTools = { lm: lm, FA: window.HowFaceAnalyze };
      } finally { setTimeout(() => URL.revokeObjectURL(wasmUrl), 5000); }
      faceProg = 1; faceListeners.forEach((f) => f(1));
      return faceTools;
    })().catch((e) => { faceLoadP = null; throw e; });
    return faceLoadP;
  }
  function updateFaceStatus(p) {
    const pc = Math.round(p * 100);
    const b1 = $('#fi-bar i'), b2 = $('#analyze-dl i');
    if (b1) b1.style.width = pc + '%'; if (b2) b2.style.width = pc + '%';
    const st = $('#fi-status'); st.classList.toggle('done', p >= 1); st.classList.remove('err');
    $('#fi-text').textContent = p >= 1 ? '분석 도구 준비 완료 · 이 휴대폰 안에서 실행돼요' : `분석 도구 내려받는 중… 처음 한 번만 (${pc}%)`;
    if ($('#screen-analyzing').classList.contains('face') && p < 1) $('#analyze-step').textContent = `분석 도구 내려받는 중… 처음 한 번만 (${pc}%)`;
  }
  faceListeners.push(updateFaceStatus);
  function openFaceIntro() {
    faceMode = true;
    show('face-intro');
    const ok = faceSupported();
    $('#fi-unsup').hidden = ok; $('#fi-actions').hidden = !ok; $('#fi-status').hidden = !ok;
    if (!ok) return;
    updateFaceStatus(faceTools ? 1 : faceProg);
    loadFaceTools().catch((e) => {
      console.warn('face tools', e);
      $('#fi-status').classList.add('err');
      $('#fi-text').textContent = '분석 도구를 내려받지 못했어요. 인터넷 연결을 확인한 뒤 다시 열어 주세요.';
    });
  }
  function exitFaceMode() {
    if (faceMode) { faceMode = false; facing = 'environment'; }
    $('#screen-camera').classList.remove('face-mode');
    $('#cam-hint').textContent = '약 10cm 거리에서 초점이 맞으면 촬영하세요';
  }
  // 반드시 탭 핸들러에서 직접 호출 (getUserMedia 이전 await 없음)
  function startFaceCamera() {
    faceMode = true; facing = 'user';
    $('#screen-camera').classList.add('face-mode');
    $('#cam-hint').textContent = '얼굴 전체가 타원 안에 들어오면 촬영하세요';
    startCamera();
  }
  function captureFace() {
    const v = $('#video'); if (!v.videoWidth) return toast('카메라가 준비 중이에요');
    const k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
    const x = c.getContext('2d', { willReadFrequently: true });
    if (facing === 'user') { x.translate(c.width, 0); x.scale(-1, 1); } // 미리보기(거울)와 같은 방향
    x.drawImage(v, 0, 0, c.width, c.height);
    stopCamera(); runFace(c);
  }
  function fromFaceImage(im) {
    const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, k = Math.min(1, 1280 / Math.max(w, h));
    let src = im;
    if (k < 0.4) { const mid = document.createElement('canvas'); mid.width = Math.round(w * k * 2); mid.height = Math.round(h * k * 2); const mx = mid.getContext('2d'); mx.imageSmoothingQuality = 'high'; mx.drawImage(im, 0, 0, mid.width, mid.height); src = mid; }
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  function coverDraw(ctx, src, W, H) { const s = Math.max(W / src.width, H / src.height), w = src.width * s, h = src.height * s; ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h); }
  async function runFace(canvas, fast) {
    if (busy) return; busy = true;
    try {
      show('analyzing');
      const sa = $('#screen-analyzing'); sa.classList.add('face');
      $('#analyze-title').textContent = '얼굴 구역을 분석하고 있어요';
      const sc = $('#scan-canvas'); coverDraw(sc.getContext('2d'), canvas, sc.width, sc.height);
      $('#analyze-dl').hidden = !!faceTools;
      $('#analyze-step').textContent = faceTools ? '얼굴 찾는 중…' : `분석 도구 내려받는 중… 처음 한 번만 (${Math.round(faceProg * 100)}%)`;
      const t = await loadFaceTools();
      $('#analyze-dl').hidden = true;
      $('#analyze-step').textContent = '얼굴 찾는 중…'; await sleep(30);
      const det = t.lm.detect(canvas);
      $('#analyze-step').textContent = '구역별 붉은기 · 유분 측정 중…'; await sleep(30);
      const W = canvas.width, H = canvas.height, data = canvas.getContext('2d').getImageData(0, 0, W, H).data;
      const n = det.faceLandmarks ? det.faceLandmarks.length : 0;
      const res = t.FA.analyze(data, W, H, n ? det.faceLandmarks[0] : null, n);
      if (!fast) await sleep(600);
      if (zonesMode && zoneSession && zoneSession.faceStep) { // 부위별 종합의 마지막 단계
        if (res.invalid) { show('face'); $('#btn-face-zskip').hidden = false; $('#face-invalid').hidden = false; $('#face-valid').hidden = true; $('#face-reasons').innerHTML = res.blockers.map((b) => `<li>${esc(b)}</li>`).join(''); coverDraw($('#face-invalid-thumb').getContext('2d'), canvas, 240, 240); return; }
        zoneSession.face = res; zoneSession.faceCanvas = canvas; zoneSession.faceStep = false; finishZones(); return;
      }
      wipeSession(); current = { mode: 'face', face: res, canvas: canvas, ts: Date.now() };
      renderFace();
    } catch (e) {
      console.warn('face analysis failed', e);
      if (zonesMode && zoneSession && zoneSession.faceStep) { toast('얼굴 분석 도구를 불러오지 못해 부위별 결과만 보여드려요'); zoneSession.faceStep = false; zoneSession.withFace = false; finishZones(); return; }
      toast('얼굴 분석 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요');
      show('face-intro');
    } finally { busy = false; $('#screen-analyzing').classList.remove('face'); }
  }
  function fmtSigned(v) { return (v > 0 ? '+' : '') + v + '%'; }
  function faceRecInput(f) {
    const cl = f.zones.cheekL, cr = f.zones.cheekR;
    const redLevel = Math.max(cl && !cl.missing ? cl.redLevel : 0, cr && !cr.missing ? cr.redLevel : 0);
    const redZones = ['forehead', 'nose', 'chin'].filter((k) => f.zones[k] && !f.zones[k].missing && f.zones[k].redLevel === 2).map((k) => f.zones[k].name);
    return { type: f.type.key, tLevel: f.tLevel, uLevel: f.uLevel, redLevel: redLevel, redZones: redZones, texture: f.texture };
  }
  const recCard = $('#rec-card'), recHome = { parent: recCard.parentNode, next: recCard.nextSibling };
  function moveRecCard(to) {
    const slot = to === true ? $('#face-rec-slot') : typeof to === 'string' ? $(to) : null;
    if (slot) { if (recCard.parentNode !== slot) slot.appendChild(recCard); }
    else if (recCard.parentNode !== recHome.parent) recHome.parent.insertBefore(recCard, recHome.next);
  }
  const SHINE_COL = ['#b9ad97', '#c4a050', '#a87a2c'], RED_COL = ['#c9a79c', '#b97b6b', '#a3604f'];
  function tuRow(label, v, lv) {
    return `<div class="tu-row"><span>${label}</span><div class="bar-bg"><div class="bar-fg" style="width:${Math.min(100, Math.max(3, v * 10))}%;background:${SHINE_COL[lv]}"></div></div><em>${LV[lv]}<small>${v}%</small></em></div>`;
  }
  function renderFace() {
    const f = current.face;
    show('face');
    $('#face-date').textContent = fmtDate(current.ts);
    $('#face-invalid').hidden = !f.invalid; $('#face-valid').hidden = !!f.invalid;
    if (f.invalid) {
      $('#face-reasons').innerHTML = f.blockers.map((b) => `<li>${esc(b)}</li>`).join('');
      coverDraw($('#face-invalid-thumb').getContext('2d'), current.canvas, 240, 240);
      return;
    }
    $('#face-type').textContent = f.type.name;
    $('#face-summary').textContent = f.summary;
    $('#face-tu').innerHTML = tuRow('T존 유분', f.tShine, f.tLevel) + tuRow('볼 유분', f.uShine, f.uLevel);
    const w = $('#face-warn'); w.hidden = !f.warnings.length;
    w.innerHTML = '<b class="warn-title">촬영 참고</b>' + f.warnings.map((x) => `<p>${esc(x)}</p>`).join('');
    $('#face-zones').innerHTML = f.order.map((k, i) => {
      const z = f.zones[k];
      if (!z || z.missing) return `<div class="zrow miss"><span class="zn"><i>${i + 1}</i>${esc(z ? z.name : k)}</span><small class="zmiss">가려져서 측정하지 못했어요</small></div>`;
      return `<div class="zrow"><span class="zn"><i>${i + 1}</i>${esc(z.name)}</span>
        <div class="zc"><small>붉은기</small><div class="mini mid" aria-hidden="true"><div style="width:${z.redBar}%;background:${RED_COL[z.redLevel]}"></div></div><em>${LV[z.redLevel]}<span>${fmtSigned(z.redPct)}</span></em></div>
        <div class="zc"><small>유분</small><div class="mini" aria-hidden="true"><div style="width:${Math.max(3, z.shineBar)}%;background:${SHINE_COL[z.shineLevel]}"></div></div><em>${LV[z.shineLevel]}<span>${z.shine}%</span></em></div>
        <div class="zt"><small>결 (참고)</small><em>${z.texture == null ? '—' : z.texture}</em></div></div>`;
    }).join('');
    moveRecCard(true);
    renderRecs();
    setFaceLayer('red');
  }
  const FACE_LEGEND = {
    red: '진한 로즈색일수록 얼굴 평균보다 붉은기가 강한 구역이에요. 작은 점은 붉은기가 두드러진 지점이에요.',
    oil: '진한 골드색일수록 빛 반사(광택)가 많은 구역이에요. 밝은 점은 유분 광택으로 보이는 지점이에요.',
    zones: '자동으로 찾은 분석 구역이에요. 번호는 아래 상세 표와 같아요.',
  };
  function drawFaceMap(x, W, H, layer, f0, c0) {
    const f = f0 || current.face, c = c0 || current.canvas, g = f.geometry.box;
    let ch = Math.max(g[3] * 1.3, g[2] * 1.5 * H / W), cw = ch * W / H;
    const sx = g[0] + g[2] / 2 - cw / 2, sy = g[1] + g[3] * 0.48 - ch / 2, k = W / cw;
    x.fillStyle = '#efe9e4'; x.fillRect(0, 0, W, H);
    x.drawImage(c, sx, sy, cw, ch, 0, 0, W, H);
    if (layer !== 'zones') { x.fillStyle = 'rgba(246,242,238,.30)'; x.fillRect(0, 0, W, H); }
    const T = (p) => [(p[0] - sx) * k, (p[1] - sy) * k], dot = Math.max(1.6, k * f.face.step * 0.9);
    f.order.forEach((key, i) => {
      const z = f.zones[key]; if (!z || !z.poly) return;
      x.beginPath(); z.poly.forEach((p, j) => { const q = T(p); if (j) x.lineTo(q[0], q[1]); else x.moveTo(q[0], q[1]); }); x.closePath();
      if (!z.missing && layer === 'red') { x.fillStyle = `rgba(163,96,79,${[0.08, 0.24, 0.42][z.redLevel]})`; x.fill(); }
      if (!z.missing && layer === 'oil') { x.fillStyle = `rgba(196,160,80,${[0.06, 0.2, 0.36][z.shineLevel]})`; x.fill(); }
      x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = Math.max(1.2, W / 400); x.stroke();
      const pts = layer === 'red' ? z.redPts : layer === 'oil' ? z.shinePts : null;
      if (pts) { x.fillStyle = layer === 'red' ? 'rgba(150,52,48,.55)' : 'rgba(255,236,170,.95)'; for (let j = 0; j < pts.length; j += 2) { const q = T([pts[j], pts[j + 1]]); x.fillRect(q[0] - dot / 2, q[1] - dot / 2, dot, dot); } }
    });
    f.order.forEach((key, i) => {
      const z = f.zones[key]; if (!z || !z.poly) return;
      let cx = 0, cy = 0; z.poly.forEach((p) => { cx += p[0]; cy += p[1]; }); const q = T([cx / z.poly.length, cy / z.poly.length]);
      const r = Math.max(9, W / 52); x.beginPath(); x.arc(q[0], q[1], r, 0, 7); x.fillStyle = 'rgba(43,37,35,.72)'; x.fill();
      x.fillStyle = '#fff'; x.font = `600 ${Math.round(r * 1.15)}px Pretendard, -apple-system, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(i + 1), q[0], q[1] + 0.5);
      x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    });
  }
  function setFaceLayer(layer) {
    faceLayer = layer;
    document.querySelectorAll('#face-layers button').forEach((b) => { const on = b.dataset.layer === layer; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    const cv = $('#face-map'); drawFaceMap(cv.getContext('2d'), cv.width, cv.height, layer);
    $('#face-legend').textContent = FACE_LEGEND[layer];
  }
  function wrapText(x, text, maxW) {
    const words = text.split(' '), lines = []; let line = '';
    words.forEach((w) => { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line); return lines;
  }
  function buildFaceShareImage() {
    const f = current.face, W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const F = 'Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif', SERIF = '"Cormorant Garamond", Georgia, serif';
    const INK = '#2b2523', SUB = '#6f6560', ACC = '#a9796d', LINE = 'rgba(43,37,35,.14)';
    x.fillStyle = '#f6f2ee'; x.fillRect(0, 0, W, H);
    x.strokeStyle = LINE; x.lineWidth = 2; x.strokeRect(48, 48, W - 96, H - 96);
    x.textAlign = 'center';
    if (LOGO.complete && LOGO.naturalWidth) { const lw = 250, lh = lw * LOGO.naturalHeight / LOGO.naturalWidth; x.drawImage(LOGO, W / 2 - lw / 2, 120, lw, lh); }
    else { x.fillStyle = INK; x.font = `600 72px ${F}`; x.fillText('H.O.W', W / 2, 185); }
    x.fillStyle = SUB; x.font = `500 26px ${F}`; spaced(x, '얼굴 피부 리포트', W / 2, 262, 8);
    const d = new Date(current.ts); x.font = `400 30px ${SERIF}`; x.fillText(`${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`, W / 2, 308);
    x.fillStyle = ACC; x.fillRect(W / 2 - 24, 340, 48, 2);
    // 지도 (붉은기)
    const mx = 120, my = 390, mw = 400, mh = 480;
    const mc = document.createElement('canvas'); mc.width = mw * 2; mc.height = mh * 2; drawFaceMap(mc.getContext('2d'), mc.width, mc.height, 'red');
    x.drawImage(mc, mx, my, mw, mh); x.strokeStyle = LINE; x.strokeRect(mx, my, mw, mh);
    // 요약
    const rx = 790;
    x.fillStyle = SUB; x.font = `500 26px ${F}`; spaced(x, '피부 타입 경향', rx, my + 60, 4);
    x.fillStyle = INK; x.font = `600 50px ${F}`; x.fillText(f.type.name, rx, my + 135);
    x.fillStyle = ACC; x.fillRect(rx - 60, my + 170, 120, 1.5);
    const fi = faceRecInput(f);
    [['T존 유분', LV[f.tLevel]], ['볼 유분', LV[f.uLevel]], ['볼 붉은기', LV[fi.redLevel]]].forEach((r, i) => {
      const y = my + 245 + i * 70;
      x.textAlign = 'left'; x.fillStyle = SUB; x.font = `500 30px ${F}`; x.fillText(r[0], 610, y);
      x.textAlign = 'right'; x.fillStyle = INK; x.font = `600 32px ${F}`; x.fillText(r[1], 970, y);
      x.fillStyle = 'rgba(43,37,35,.10)'; x.fillRect(610, y + 22, 360, 2);
    });
    x.textAlign = 'center'; x.fillStyle = INK; x.font = `500 30px ${F}`;
    wrapText(x, f.summary, 840).slice(0, 2).forEach((ln, i) => x.fillText(ln, W / 2, 960 + i * 46));
    if (current.care && current.tone) {
      const sn = REC.SEASONS[currentSeason()].name + (getSeasonChoice() === 'auto' ? '(추정)' : '');
      x.fillStyle = INK; x.font = `500 26px ${F}`; x.fillText(`${sn}   ·   케어 ${current.care.priorityName}`, W / 2, 1075);
    }
    x.fillStyle = '#8b807a'; x.font = `400 22px ${F}`;
    x.fillText('같은 사진 안의 상대 비교 · 조명에 따라 달라지는 참고용 결과이며 의학적 진단이 아니에요', W / 2, H - 92);
    return c;
  }
  $('#btn-face-mode').onclick = openFaceIntro;
  $('#btn-fi-home').onclick = () => { exitFaceMode(); show('intro'); };
  $('#btn-fi-close').onclick = () => { exitFaceMode(); show('intro'); };
  $('#btn-face-cam').onclick = startFaceCamera;
  $('#btn-face-retake').onclick = () => { startFaceCamera(); if (zonesMode) $('#screen-camera').classList.add('zone-mode'); };
  $('#btn-face-zskip').onclick = () => { if (zoneSession) { zoneSession.faceStep = false; zoneSession.withFace = false; finishZones(); } };
  $('#btn-face-again').onclick = () => openFaceIntro();
  $('#btn-face-home').onclick = () => { exitFaceMode(); show('intro'); };
  $('#btn-face-next').onclick = nextCustomer;
  $('#btn-face-share').onclick = shareResult;
  $('#face-layers').onclick = (e) => { const l = e.target.dataset && e.target.dataset.layer; if (l) setFaceLayer(l); };

  // ---------- 부위별 종합 측정 (여러 부위를 차례로 가까이 촬영 · 기존 피부결 엔진 + 색 기반 붉은기/유분) ----------
  const ZONE_DEF = [
    { key: 'forehead', name: '이마', tip: '이마 가운데를 사각형 안에', w: 1, tz: 'T' },
    { key: 'cheekL', name: '왼쪽 볼', tip: '왼쪽 볼(내 얼굴 기준)을 사각형 안에', w: 1.2, tz: 'U' },
    { key: 'cheekR', name: '오른쪽 볼', tip: '오른쪽 볼(내 얼굴 기준)을 사각형 안에', w: 1.2, tz: 'U' },
    { key: 'nose', name: '코', tip: '콧등과 코 옆을 사각형 안에', w: 0.8, tz: 'T' },
    { key: 'chin', name: '턱', tip: '턱 끝을 사각형 안에', w: 0.8, tz: 'U' },
    { key: 'eye', name: '눈가', tip: '눈꼬리 옆 피부를 사각형 안에 (눈은 피해서)', w: 0.6, tz: null },
  ];
  // 마주 본 얼굴 기준 도식 좌표 [cx, cy, rx, ry] (내 얼굴 왼쪽 볼은 그림의 오른쪽)
  const ZONE_GEO = { forehead: [0.5, 0.25, 0.19, 0.075], nose: [0.5, 0.5, 0.065, 0.11], cheekL: [0.71, 0.6, 0.11, 0.085], cheekR: [0.29, 0.6, 0.11, 0.085], chin: [0.5, 0.835, 0.1, 0.05], eye: [0.7, 0.41, 0.065, 0.033] };
  let zonesMode = false, zoneSession = null;
  function zoneSteps() { return zoneSession ? zoneSession.steps : ZONE_DEF.slice(0, 5); }
  function zoneSVG(active, doneKeys, all) {
    const keys = all || ZONE_DEF.map((z) => z.key);
    const zs = keys.map((k) => { const g = ZONE_GEO[k], on = k === active, done = doneKeys && doneKeys.indexOf(k) >= 0;
      return `<ellipse cx="${g[0] * 100}" cy="${g[1] * 112}" rx="${g[2] * 100}" ry="${g[3] * 112}" fill="${on ? '#a9796d' : done ? '#5f7d72' : 'none'}" fill-opacity="${on ? 0.85 : done ? 0.45 : 0}" stroke="${on ? '#a9796d' : 'currentColor'}" stroke-opacity="${on ? 1 : 0.45}" stroke-width="1"${on || done ? '' : ' stroke-dasharray="2 2"'}/>`; }).join('');
    return `<svg viewBox="0 0 100 112" aria-hidden="true"><ellipse cx="50" cy="59" rx="36" ry="50" fill="none" stroke="currentColor" stroke-opacity=".55" stroke-width="1"/><path d="M33 41q6-3 12 0M55 41q6-3 12 0M42 78q8 4 16 0" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="1" stroke-linecap="round"/>${zs}</svg>`;
  }
  function openZonesIntro() {
    exitFaceMode(); wipeSession(); // 이전 결과는 새 측정을 시작하면 지움
    show('zones-intro');
    const sup = faceSupported();
    $('#zi-face').disabled = !sup; $('#zi-face').checked = false; $('#zi-face-wrap').classList.toggle('off', !sup); $('#zi-face-note').hidden = sup;
    $('#zi-eye').checked = false;
    renderZonesIntroSteps();
  }
  function renderZonesIntroSteps() {
    const keys = ZONE_DEF.filter((z) => z.key !== 'eye' || $('#zi-eye').checked).map((z) => z.key);
    $('#zi-ill').innerHTML = zoneSVG(null, keys, keys);
    $('#zi-steps').innerHTML = ZONE_DEF.filter((z) => keys.indexOf(z.key) >= 0).map((z) => `<li>${esc(z.name)}</li>`).join('') + ($('#zi-face').checked ? '<li>얼굴 전체 <small>Beta</small></li>' : '');
  }
  // 반드시 탭 핸들러에서 직접 호출 (카메라 권한)
  function startZones() {
    const steps = ZONE_DEF.filter((z) => z.key !== 'eye' || $('#zi-eye').checked);
    zoneSession = { steps, idx: 0, res: {}, face: null, faceCanvas: null, withFace: $('#zi-face').checked && faceSupported(), faceStep: false };
    if (zoneSession.withFace) loadFaceTools().catch(() => {}); // 미리 내려받기 (실패하면 얼굴 단계 건너뜀)
    startZoneStep();
  }
  function zoneTotal() { return zoneSession.steps.length + (zoneSession.withFace ? 1 : 0); }
  function zoneDots(el) {
    const s = zoneSession; let h = '';
    s.steps.forEach((z, i) => { const r = s.res[z.key]; h += `<i class="${i === s.idx && !s.faceStep ? 'cur' : r ? (r.status === 'ok' ? 'ok' : 'skip') : ''}"></i>`; });
    if (s.withFace) h += `<i class="${s.faceStep ? 'cur' : s.face ? 'ok' : ''}"></i>`;
    el.innerHTML = h;
  }
  function startZoneStep() {
    const s = zoneSession, z = s.steps[s.idx];
    zonesMode = true; s.faceStep = false; faceMode = false; facing = 'environment';
    const cam = $('#screen-camera'); cam.classList.remove('face-mode'); cam.classList.add('zone-mode');
    $('#zone-step').textContent = `${s.idx + 1} / ${zoneTotal()}`; $('#zone-name').textContent = z.name;
    $('#zone-ill').innerHTML = zoneSVG(z.key, Object.keys(s.res).filter((k) => s.res[k].status === 'ok'), s.steps.map((q) => q.key));
    zoneDots($('#zone-dots'));
    $('#guide-tip').textContent = z.tip; $('#btn-zone-skip').hidden = false; $('#btn-zone-skip').textContent = '이 부위 건너뛰기';
    $('#cam-hint').textContent = '약 10cm 거리에서 초점이 맞으면 촬영하세요';
    startCamera();
  }
  function startZoneFaceStep() {
    const s = zoneSession; s.faceStep = true; zonesMode = true;
    $('#zone-step').textContent = `${zoneTotal()} / ${zoneTotal()}`; $('#zone-name').textContent = '얼굴 전체';
    $('#zone-ill').innerHTML = zoneSVG(null, s.steps.map((q) => q.key), s.steps.map((q) => q.key)); zoneDots($('#zone-dots'));
    $('#btn-zone-skip').hidden = false; $('#btn-zone-skip').textContent = '얼굴 전체 건너뛰고 결과 보기';
    startFaceCamera(); $('#screen-camera').classList.add('zone-mode');
  }
  function exitZonesMode() { zonesMode = false; $('#screen-camera').classList.remove('zone-mode'); $('#guide-tip').textContent = '볼 또는 이마를 사각형 안에'; }
  function colorStats(canvas) {
    const N = SA.WORK, d = canvas.getContext('2d').getImageData(0, 0, N, N).data, Ls = [], As = [], Cs = [];
    for (let y = 2; y < N; y += 3) for (let x = 2; x < N; x += 3) { const i = (y * N + x) * 4, q = REC.srgbToLab(d[i], d[i + 1], d[i + 2]); Ls.push(q.L); As.push(q.a); Cs.push(Math.sqrt(q.a * q.a + q.b * q.b)); }
    const med = (v) => { const t = v.slice().sort((a, b) => a - b); return t[t.length >> 1]; };
    const mL = med(Ls), mC = med(Cs), sd = Math.sqrt(Ls.reduce((s, v) => s + (v - mL) * (v - mL), 0) / Ls.length);
    const thr = Math.min(97, mL + Math.max(7, 1.3 * sd)); let n = 0;
    for (let i = 0; i < Ls.length; i++) if (Ls[i] >= thr && Cs[i] <= 0.85 * mC) n++;
    return { a: med(As), L: mL, shine: Math.round(n / Ls.length * 1000) / 10 };
  }
  function captureZone() {
    const v = $('#video'); if (!v.videoWidth) return toast('카메라가 준비 중이에요');
    const r = guideRectInVideo();
    const c = makeWorkCanvas((ctx, N) => ctx.drawImage(v, r.sx, r.sy, r.size, r.size, 0, 0, N, N));
    stopCamera(); runZone(c);
  }
  async function runZone(canvas) {
    if (busy || !zoneSession) return; busy = true;
    try {
      const s = zoneSession, z = s.steps[s.idx];
      show('analyzing'); $('#analyze-title').textContent = `${z.name} 피부를 분석하고 있어요`; $('#analyze-dl').hidden = true;
      $('#scan-canvas').getContext('2d').drawImage(canvas, 0, 0, 360, 360);
      $('#analyze-step').textContent = '피부결 · 모공 · 잔주름 · 색 분석 중…'; await sleep(60);
      const result = SA.analyzeRGBA(canvas.getContext('2d').getImageData(0, 0, SA.WORK, SA.WORK).data, SA.WORK);
      const color = result.invalid ? null : colorStats(canvas);
      await sleep(350);
      s.res[z.key] = { status: result.invalid ? 'invalid' : 'ok', result, canvas, color };
      renderZoneStep();
    } finally { busy = false; }
  }
  function renderZoneStep() {
    const s = zoneSession, z = s.steps[s.idx], r = s.res[z.key], ok = r.status === 'ok';
    show('zone-step');
    $('#zs-prog').textContent = `${s.idx + 1} / ${zoneTotal()}`; $('#zs-label').textContent = `${s.idx + 1} / ${zoneTotal()} 단계`; $('#zs-name').textContent = z.name;
    $('#zs-thumb').getContext('2d').drawImage(r.canvas, 0, 0, 240, 240);
    $('#screen-zone-step').classList.toggle('invalid', !ok);
    if (ok) {
      const sc = r.result.scores;
      $('#zs-sum').innerHTML = `<em class="zs-score">${sc.overall}</em> ${esc(label(sc.overall))}`;
      $('#zs-metrics').innerHTML = METRICS.map((m) => `<div class="zs-m"><span>${m.name}</span><div class="bar-bg"><div class="bar-fg" style="width:${sc[m.key]}%;background:${toneOf(sc[m.key])}"></div></div><em>${sc[m.key]}</em></div>`).join('') + `<p class="zs-color">광택 ${r.color.shine}% · 붉은기와 유분은 다른 부위와 비교해 종합 결과에 반영돼요</p>`;
      $('#zs-reasons').hidden = true;
    } else {
      $('#zs-sum').textContent = '측정할 수 없는 사진이에요';
      $('#zs-metrics').innerHTML = '';
      $('#zs-reasons').hidden = false; $('#zs-reasons').innerHTML = r.result.blockers.map((b) => `<li>${esc(b)}</li>`).join('');
    }
    const last = s.idx === s.steps.length - 1, nextName = last ? (s.withFace ? '얼굴 전체' : null) : s.steps[s.idx + 1].name;
    const nb = $('#btn-zs-next'); nb.hidden = !ok; nb.textContent = nextName ? `다음: ${nextName}` : '종합 결과 보기';
    $('#btn-zs-skip').textContent = ok ? '이 부위 제외' : '건너뛰기';
    $('#btn-zs-retake').className = ok ? 'btn ghost' : 'btn primary';
    zoneDots($('#zs-dots'));
  }
  function zoneAdvance() {
    const s = zoneSession; if (!s) return;
    if (s.idx < s.steps.length - 1) { s.idx++; return startZoneStep(); }
    if (s.withFace && !s.face) { if (faceSupported()) return startZoneFaceStep(); }
    finishZones();
  }
  function zoneSkip() {
    const s = zoneSession; if (!s) return;
    if (s.faceStep) { stopCamera(); exitFaceMode(); s.faceStep = false; s.withFace = false; return finishZones(); }
    s.res[s.steps[s.idx].key] = { status: 'skipped' };
    stopCamera(); zoneAdvance();
  }
  function zoneSummary(s) {
    const zones = s.steps.map((d) => { const r = s.res[d.key] || { status: 'skipped' };
      return { key: d.key, name: d.name, w: d.w, tz: d.tz, status: r.status === 'ok' ? 'ok' : r.status === 'invalid' ? 'invalid' : 'skipped', scores: r.result && !r.result.invalid ? r.result.scores : null, grade: r.result && r.result.grade, warnings: r.result && !r.result.invalid ? r.result.warnings : [], color: r.color, canvas: r.canvas, viz: r.result && r.result.viz, rgb: r.result && r.result.raw && r.result.raw.rgb }; });
    const ok = zones.filter((z) => z.status === 'ok');
    if (!ok.length) return null;
    const W = ok.reduce((t, z) => t + z.w, 0), wavg = (k) => Math.round(ok.reduce((t, z) => t + z.w * z.scores[k], 0) / W);
    const agg = { smooth: wavg('smooth'), pore: wavg('pore'), lines: wavg('lines'), overall: wavg('overall') };
    const as = ok.map((z) => z.color.a).sort((a, b) => a - b), medA = as[as.length >> 1];
    ok.forEach((z) => { z.redRel = Math.round((z.color.a - medA) * 10) / 10; z.redLevel = z.redRel < 1.5 ? 0 : z.redRel < 3.5 ? 1 : 2; z.shine = z.color.shine; z.shineLevel = z.shine < REC.SHINE_T[0] ? 0 : z.shine < REC.SHINE_T[1] ? 1 : 2; });
    const mean = (arr) => arr.length ? Math.round(arr.reduce((t, v) => t + v, 0) / arr.length * 10) / 10 : null;
    let T = mean(ok.filter((z) => z.tz === 'T').map((z) => z.shine)), U = mean(ok.filter((z) => z.tz === 'U').map((z) => z.shine)), typeSrc = 'zones';
    const f = s.face && !s.face.invalid ? s.face : null;
    if (f) { T = f.tShine; U = f.uShine; typeSrc = 'face'; }
    const lv = (v) => v == null ? 0 : v < REC.SHINE_T[0] ? 0 : v < REC.SHINE_T[1] ? 1 : 2;
    const type = T != null && U != null ? REC.skinTypeTU(T, U) : T != null ? REC.skinTypeTU(T, T / 2) : U != null ? REC.skinTypeTU(U, U) : { key: 'drynormal', name: '건성·중성 경향' };
    const cheeks = ok.filter((z) => z.key === 'cheekL' || z.key === 'cheekR');
    let redLevel = cheeks.length ? Math.max.apply(null, cheeks.map((z) => z.redLevel)) : 0;
    if (f) { const fi0 = faceRecInput(f); redLevel = Math.max(redLevel, fi0.redLevel); }
    const fi = { type: type.key, tLevel: lv(T), uLevel: lv(U), redLevel, redZones: ok.filter((z) => z.redLevel === 2 && z.tz === 'T').map((z) => z.name), texture: null };
    const sorted = ok.slice().sort((a, b) => b.scores.overall - a.scores.overall);
    const rgbSrc = cheeks.length ? cheeks : ok, skinRGB = f ? f.skinRGB : [0, 1, 2].map((i) => rgbSrc.reduce((t, z) => t + z.rgb[i], 0) / rgbSrc.length);
    const warnings = [];
    ok.forEach((z) => z.warnings.forEach((w) => warnings.push(`${z.name}: ${w}`)));
    if (f && f.warnings) f.warnings.forEach((w) => warnings.push(`얼굴 전체: ${w}`));
    return { zones, ok, agg, overall: agg.overall, grade: SA.gradeOf(agg.overall), best: sorted[0], worst: sorted[sorted.length - 1], T, U, type, typeSrc, fi, skinRGB, warnings, face: f, faceCanvas: f ? s.faceCanvas : null, skipped: zones.filter((z) => z.status !== 'ok').length };
  }
  function finishZones() {
    const s = zoneSession; if (!s) return;
    const sum = zoneSummary(s);
    stopCamera(); exitFaceMode(); exitZonesMode();
    if (!sum) { toast('측정된 부위가 없어요. 한 부위 이상 촬영해 주세요'); zoneSession = null; return openZonesIntro(); }
    wipeSession();
    current = { mode: 'zones', zones: sum, ts: Date.now() };
    renderZones();
  }
  function drawZoneDiagram(x, W, H, sum) {
    x.fillStyle = '#f6f2ee'; x.fillRect(0, 0, W, H);
    const k = Math.min(W / 100, H / 112), ox = (W - 100 * k) / 2, oy = (H - 112 * k) / 2, P = (gx, gy) => [ox + gx * 100 * k, oy + gy * 112 * k];
    x.save(); x.beginPath(); x.ellipse(ox + 50 * k, oy + 59 * k, 36 * k, 50 * k, 0, 0, 7); x.fillStyle = '#fdfbf9'; x.fill(); x.strokeStyle = 'rgba(43,37,35,.25)'; x.lineWidth = Math.max(1, k * 0.35); x.stroke();
    x.strokeStyle = 'rgba(43,37,35,.18)'; x.lineCap = 'round'; x.beginPath(); x.moveTo(ox + 33 * k, oy + 41 * k); x.quadraticCurveTo(ox + 39 * k, oy + 38 * k, ox + 45 * k, oy + 41 * k); x.moveTo(ox + 55 * k, oy + 41 * k); x.quadraticCurveTo(ox + 61 * k, oy + 38 * k, ox + 67 * k, oy + 41 * k); x.moveTo(ox + 42 * k, oy + 78 * k); x.quadraticCurveTo(ox + 50 * k, oy + 82 * k, ox + 58 * k, oy + 78 * k); x.stroke(); x.restore();
    const F = 'Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif', SERIF = '"Cormorant Garamond", Georgia, serif';
    sum.zones.forEach((z) => {
      const g = ZONE_GEO[z.key], c = P(g[0], g[1]), rx = g[2] * 100 * k, ry = g[3] * 112 * k;
      x.beginPath(); x.ellipse(c[0], c[1], rx, ry, 0, 0, 7);
      if (z.status === 'ok') { x.fillStyle = toneOf(z.scores.overall); x.globalAlpha = 0.5; x.fill(); x.globalAlpha = 1; x.strokeStyle = toneOf(z.scores.overall); x.setLineDash([]); }
      else { x.strokeStyle = 'rgba(43,37,35,.35)'; x.setLineDash([k * 1.2, k * 1.2]); }
      x.lineWidth = Math.max(1, k * 0.4); x.stroke(); x.setLineDash([]);
      x.textAlign = 'center'; x.fillStyle = '#2b2523';
      const small = z.key === 'eye';
      x.font = `500 ${Math.round(k * (small ? 5.5 : 8))}px ${SERIF}`; x.textBaseline = 'middle';
      x.fillText(z.status === 'ok' ? String(z.scores.overall) : '—', c[0], c[1] + k * 0.3);
      x.font = `600 ${Math.round(k * 3.4)}px ${F}`; x.fillStyle = '#6f6560'; x.textBaseline = 'alphabetic';
      const ly = z.key === 'forehead' ? c[1] - ry - k * 1.6 : c[1] + ry + k * 4.2;
      x.fillText(z.name + (z.status === 'ok' ? '' : z.status === 'invalid' ? ' (측정 불가)' : ' (건너뜀)'), c[0], ly);
    });
    x.textAlign = 'left';
  }
  function renderZones() {
    const S = current.zones;
    show('zones');
    $('#zr-date').textContent = fmtDate(current.ts);
    $('#zr-overall').textContent = S.overall;
    $('#zr-ring').setAttribute('aria-label', `부위별 종합 점수 ${S.overall}점, 등급 ${S.grade.key} ${S.grade.label}`);
    $('#zr-grade').textContent = S.grade.key; $('#zr-grade-label').textContent = S.grade.label; $('#zr-grade-desc').textContent = S.grade.desc;
    const bar = $('#zr-ring-bar'); bar.style.stroke = TONE.ink; bar.style.strokeDashoffset = 326.7;
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.strokeDashoffset = 326.7 * (1 - S.overall / 100); }));
    $('#zr-count').textContent = `${S.zones.length}개 부위 중 ${S.ok.length}개 측정${S.skipped ? ` · ${S.skipped}개 제외` : ''} · 부위별 가중 평균`;
    $('#zr-best').innerHTML = S.ok.length > 1
      ? `<div><span class="rec-label">가장 좋은 부위</span><b>${esc(S.best.name)}</b><em>${S.best.scores.overall}</em></div><div><span class="rec-label">관리가 필요한 부위</span><b>${esc(S.worst.name)}</b><em>${S.worst.scores.overall}</em></div>`
      : `<div><span class="rec-label">측정한 부위</span><b>${esc(S.best.name)}</b><em>${S.best.scores.overall}</em></div>`;
    const mc = $('#zr-map'); drawZoneDiagram(mc.getContext('2d'), mc.width, mc.height, S);
    $('#zr-list').innerHTML = S.zones.map((z) => {
      if (z.status !== 'ok') return `<div class="zr-row miss"><span class="zr-n">${esc(z.name)}</span><small>${z.status === 'invalid' ? '측정할 수 없는 사진이라 제외했어요' : '건너뛰었어요'}</small></div>`;
      const sc = z.scores;
      return `<div class="zr-row"><span class="zr-n">${esc(z.name)}</span><em class="zr-s" style="color:${toneOf(sc.overall)}">${sc.overall}</em>
        <div class="zr-m">${METRICS.map((m) => `<span>${m.name} <b>${sc[m.key]}</b></span>`).join('')}</div>
        <div class="zr-c"><span>붉은기 <b>${LV[z.redLevel]}</b> <small>${z.redRel > 0 ? '+' : ''}${z.redRel}</small></span><span>유분 <b>${LV[z.shineLevel]}</b> <small>${z.shine}%</small></span></div></div>`;
    }).join('');
    $('#zr-type').textContent = S.type.name;
    $('#zr-tu').innerHTML = (S.T != null ? tuRow('T존 유분', S.T, S.fi.tLevel) : '') + (S.U != null ? tuRow('U존 유분', S.U, S.fi.uLevel) : '');
    $('#zr-type-note').textContent = S.typeSrc === 'face' ? '얼굴 전체 사진의 T존(이마·코)과 U존(볼·턱) 광택을 비교했어요.' : 'T존(이마·코)과 U존(볼·턱) 사진의 광택을 비교했어요. 부위마다 조명이 조금씩 달라질 수 있어 참고용이에요.';
    const fc = $('#zr-face'); fc.hidden = !S.face;
    if (S.face) { const cv = $('#zr-face-map'); drawFaceMap(cv.getContext('2d'), cv.width, cv.height, 'red', S.face, S.faceCanvas); $('#zr-face-sum').textContent = `${S.face.type.name} · ${S.face.summary}`; }
    const w = $('#zr-warn'); w.hidden = !S.warnings.length;
    w.innerHTML = '<b class="warn-title">촬영 참고</b>' + S.warnings.map((x) => `<p>${esc(x)}</p>`).join('');
    moveRecCard('#zones-rec-slot');
    renderRecs();
  }
  $('#btn-zones-mode').onclick = openZonesIntro;
  $('#zi-eye').onchange = renderZonesIntroSteps; $('#zi-face').onchange = renderZonesIntroSteps;
  $('#btn-zi-home').onclick = () => show('intro');
  $('#btn-zones-start').onclick = startZones;
  $('#btn-zone-skip').onclick = onScreen('camera', zoneSkip);
  $('#btn-zs-next').onclick = onScreen('zone-step', zoneAdvance);
  $('#btn-zs-retake').onclick = onScreen('zone-step', () => { if (zoneSession) startZoneStep(); });
  $('#btn-zs-skip').onclick = onScreen('zone-step', () => { const s = zoneSession; if (!s) return; s.res[s.steps[s.idx].key] = { status: 'skipped' }; zoneAdvance(); });
  $('#btn-zs-home').onclick = () => show('intro');
  $('#btn-zr-home').onclick = () => show('intro');
  $('#btn-zones-next').onclick = nextCustomer;
  $('#btn-zones-again').onclick = () => openZonesIntro();
  $('#btn-zones-report').onclick = () => openReport();

  // ---------- 전체 결과 리포트 (report.js는 필요할 때만 불러옴) ----------
  const APP_URL = 'https://handj1998-del.github.io/skin-tester/';
  function resetReport() {
    try { restorePrint(); } catch (e) {}
    if (reportPages) reportPages.forEach(freeCanvas);
    reportName = ''; reportPages = null; reportTimer && clearTimeout(reportTimer);
    const inp = $('#rep-name'); if (inp) inp.value = '';
    const pv = $('#rep-preview'); if (pv) pv.innerHTML = '';
  }
  function loadReportLib() {
    if (window.HowReport) return Promise.resolve(window.HowReport);
    if (!reportP) reportP = loadScript('report.js?v=' + APP_VERSION).then(() => window.HowReport).catch((e) => { reportP = null; throw e; });
    return reportP;
  }
  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function reportData() {
    const isFace = current.mode === 'face', S = REC.SEASONS[currentSeason()];
    const d = {
      mode: isFace ? 'face' : current.mode === 'zones' ? 'zones' : 'closeup', ts: current.ts, name: reportName.trim(), version: APP_VERSION, url: APP_URL, logo: LOGO,
      title: isFace ? '얼굴 피부 분석 리포트' : current.mode === 'zones' ? '부위별 종합 리포트' : '피부결 분석 리포트',
      care: current.care, makeup: current.makeup, tone: current.tone, season: S, estSeason: REC.SEASONS[current.tone.season], seasonChosen: getSeasonChoice() !== 'auto',
      skinRGB: current.skinRGB.map((v) => Math.round(v)), store: staff.store || '',
    };
    if (current.mode === 'zones') {
      const Z = current.zones;
      d.overall = Z.overall; d.grade = Z.grade; d.warnings = Z.warnings.slice();
      d.best = { name: Z.best.name, score: Z.best.scores.overall }; d.worst = { name: Z.worst.name, score: Z.worst.scores.overall };
      d.count = `${Z.ok.length} / ${Z.zones.length}곳`; d.single = Z.ok.length < 2;
      const mc = mk(900, 1013); drawZoneDiagram(mc.getContext('2d'), 900, 1013, Z); d.map = mc;
      d.thumbs = Z.ok.map((z) => { const c = mk(480, 480); c.getContext('2d').drawImage(z.canvas, 0, 0, 480, 480); return { canvas: c, title: `${z.name} · ${z.scores.overall}점`, caption: `매끄러움 ${z.scores.smooth} · 모공 ${z.scores.pore} · 잔주름 ${z.scores.lines}` }; });
      d.rows = Z.zones.map((z) => z.status !== 'ok' ? { name: z.name, ok: false, missText: z.status === 'invalid' ? '측정할 수 없는 사진이라 제외' : '건너뜀' }
        : { name: z.name, ok: true, overall: z.scores.overall, label: label(z.scores.overall), color: toneOf(z.scores.overall), smooth: z.scores.smooth, pore: z.scores.pore, lines: z.scores.lines, red: LV[z.redLevel], redRel: (z.redRel > 0 ? '+' : '') + z.redRel, shine: LV[z.shineLevel], shinePct: z.shine + '%' });
      d.type = Z.type; d.typeNote = Z.typeSrc === 'face' ? '얼굴 전체 사진의 T존(이마·코)과 U존(볼·턱) 광택을 비교했어요.' : 'T존(이마·코)과 U존(볼·턱) 사진의 광택을 비교한 참고값이에요.';
      d.tu = []; if (Z.T != null) d.tu.push({ label: 'T존 유분 (이마·코)', v: Z.T, level: LV[Z.fi.tLevel], color: SHINE_COL[Z.fi.tLevel] }); if (Z.U != null) d.tu.push({ label: 'U존 유분 (볼·턱)', v: Z.U, level: LV[Z.fi.uLevel], color: SHINE_COL[Z.fi.uLevel] });
      if (Z.face) { d.faceImages = [['red', '붉은기 지도', FACE_LEGEND.red], ['oil', '유분(광택) 지도', FACE_LEGEND.oil]].map((q) => { const c = mk(600, 720); drawFaceMap(c.getContext('2d'), 600, 720, q[0], Z.face, Z.faceCanvas); return { canvas: c, title: q[1], caption: q[2] }; }); d.faceSummary = `${Z.face.type.name} · ${Z.face.summary}`; }
      d.disclaimer = '부위별 결과는 같은 조명에서 찍은 부위끼리의 상대 비교이며 조명·거리·초점·카메라 기종에 따라 달라질 수 있어요. 의학적 진단이 아닙니다. 피부 질환이 의심되면 전문의와 상담하세요.';
    } else if (isFace) {
      const f = current.face;
      d.type = f.type; d.summary = f.summary; d.warnings = f.warnings.slice();
      d.tu = [{ label: 'T존 유분 (이마·코)', v: f.tShine, level: LV[f.tLevel], color: SHINE_COL[f.tLevel] }, { label: '볼 유분 (U존)', v: f.uShine, level: LV[f.uLevel], color: SHINE_COL[f.uLevel] }];
      d.images = [['zones', '분석 구역', FACE_LEGEND.zones], ['red', '붉은기 지도', FACE_LEGEND.red], ['oil', '유분(광택) 지도', FACE_LEGEND.oil]].map((q) => { const c = mk(640, 640); drawFaceMap(c.getContext('2d'), 640, 640, q[0]); return { canvas: c, title: q[1], caption: q[2] }; });
      d.zones = f.order.map((k, i) => { const z = f.zones[k]; if (!z || z.missing) return { n: i + 1, name: z ? z.name : k, missing: true };
        return { n: i + 1, name: z.name, red: { level: LV[z.redLevel], text: fmtSigned(z.redPct), bar: z.redBar, color: RED_COL[z.redLevel] }, shine: { level: LV[z.shineLevel], text: z.shine + '%', bar: z.shineBar, color: SHINE_COL[z.shineLevel] }, texture: z.texture }; });
      d.disclaimer = '얼굴 분석은 같은 사진 안에서 구역끼리 비교한 상대값이에요. 조명 방향·화이트밸런스·메이크업·카메라 기종에 따라 크게 달라지며 의학적 진단이 아닙니다. 피부 질환이 의심되면 전문의와 상담하세요.';
    } else {
      const r = current.result, sc = r.scores;
      d.overall = sc.overall; d.grade = r.grade; d.warnings = r.warnings.slice();
      d.metrics = METRICS.map((m) => ({ name: m.name, en: m.en, score: sc[m.key], label: label(sc[m.key]), color: toneOf(sc[m.key]), desc: m.desc + '.', note: sc[m.key] < 72 ? TIPS[m.key].p : '' }));
      d.images = [['original', '원본 (분석 영역)'], ['heat', '거칠기 맵'], ['pores', '모공'], ['lines', '잔주름']].map((q) => { const c = mk(720, 720); SA.renderOverlay(c.getContext('2d'), current.canvas, r.viz, q[0]); return { canvas: c, title: q[1], caption: LEGEND[q[0]] + (q[0] === 'pores' ? ` 감지 ${r.viz.pores.length}개.` : '') }; });
      d.disclaimer = '본 결과는 피부결의 상대적 경향을 보여주는 참고용 정보이며 의학적 진단이 아닙니다. 조명·거리·초점·카메라 기종에 따라 결과가 달라질 수 있어요. 피부 질환이 의심되면 전문의와 상담하세요.';
    }
    return d;
  }
  function reportFileBase() { const d = new Date(current.ts); return `HOW_${current.mode === 'face' ? '얼굴분석' : current.mode === 'zones' ? '부위별종합' : '피부결'}_리포트_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`; }
  async function buildReport() {
    const R = await loadReportLib();
    try { await Promise.all([document.fonts.load('300 110px "Cormorant Garamond"'), document.fonts.load('500 24px "Cormorant Garamond"')]); } catch (e) {}
    if (!LOGO.complete) await new Promise((r) => { LOGO.onload = LOGO.onerror = r; setTimeout(r, 1500); });
    reportPages = R.render(reportData());
    const pv = $('#rep-preview'); pv.innerHTML = '';
    reportPages.forEach((c, i) => { c.setAttribute('role', 'img'); c.setAttribute('aria-label', `리포트 ${i + 1}쪽`); c.className = 'rep-page'; pv.appendChild(c); });
    $('#rep-status').textContent = `A4 ${reportPages.length}쪽 · 미리보기`;
    return reportPages;
  }
  let reportOpening = false;
  async function openReport() {
    if (activeId() === 'report') return; // 연타 방지 (show('report')가 바로 화면을 바꿈)
    if (!current || (current.mode === 'face' ? current.face.invalid : current.mode === 'zones' ? !current.zones : current.result.invalid)) return;
    show('report');
    $('#rep-date').textContent = fmtDate(current.ts);
    $('#rep-name').value = reportName;
    $('#rep-status').textContent = '리포트를 만드는 중…'; $('#rep-preview').innerHTML = '';
    try { await buildReport(); }
    catch (e) { console.warn('report', e); $('#rep-status').textContent = '리포트를 만들지 못했어요. 인터넷 연결을 확인한 뒤 다시 열어 주세요.'; }
  }
  function download(blob, name) {
    const href = URL.createObjectURL(blob), a = document.createElement('a'); a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 60000);
  }
  function canvasBlob(c, type, q) { return new Promise((res, rej) => { if (c.toBlob) c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), type, q); else { try { const bin = atob(c.toDataURL(type, q).split(',')[1]), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); res(new Blob([u], { type })); } catch (e) { rej(e); } } }); }
  async function reportAction(btn, busyText, fn) {
    if (reportBusy || !current) return; reportBusy = true;
    const b = $(btn), t = b.textContent; b.setAttribute('aria-busy', 'true'); b.textContent = busyText;
    try { if (!reportPages) await buildReport(); await fn(); }
    catch (e) { console.warn('report action', e); toast('리포트를 저장하지 못했어요'); }
    finally { b.textContent = t; b.removeAttribute('aria-busy'); reportBusy = false; }
  }
  async function reportImageBlob() { return canvasBlob(window.HowReport.toLongImage(reportPages, 0.75), 'image/jpeg', 0.9); }
  async function reportPdfBlob() { return window.HowReport.toPDF(reportPages, { title: 'H.O.W Skin Report' }); }
  async function saveReportImage() { download(await reportImageBlob(), reportFileBase() + '.jpg'); toast('리포트 이미지를 저장했어요'); }
  async function saveReportPdf() {
    let blob; try { blob = await reportPdfBlob(); } catch (e) { console.warn('pdf', e); toast('이 기기에서는 PDF를 만들 수 없어 이미지로 저장할게요'); return saveReportImage(); }
    download(blob, reportFileBase() + '.pdf'); toast('PDF 리포트를 저장했어요');
  }
  async function shareReport() {
    let blob, name, type;
    try { blob = await reportPdfBlob(); name = reportFileBase() + '.pdf'; type = 'application/pdf'; }
    catch (e) { blob = await reportImageBlob(); name = reportFileBase() + '.jpg'; type = 'image/jpeg'; }
    let file = null; try { file = new File([blob], name, { type }); } catch (e) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'H.O.W 피부 분석 리포트' }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    download(blob, name); toast(type === 'application/pdf' ? '공유를 지원하지 않아 PDF로 저장했어요' : '리포트 이미지를 저장했어요');
  }
  $('#btn-report').onclick = openReport;
  $('#btn-face-report').onclick = openReport;
  $('#btn-rep-back').onclick = () => { if (current) show(current.mode === 'face' ? 'face' : current.mode === 'zones' ? 'zones' : 'result'); else show('intro'); };
  $('#btn-rep-pdf').onclick = () => reportAction('#btn-rep-pdf', 'PDF 만드는 중…', saveReportPdf);
  $('#btn-rep-img').onclick = () => reportAction('#btn-rep-img', '이미지 만드는 중…', saveReportImage);
  $('#btn-rep-share').onclick = () => reportAction('#btn-rep-share', '준비 중…', shareReport);
  $('#rep-name').addEventListener('input', (e) => {
    reportName = e.target.value.slice(0, 20); reportPages = null;
    clearTimeout(reportTimer); reportTimer = setTimeout(() => { if (current) buildReport().catch(() => {}); }, 450);
  });

  // ---------- 이벤트 ----------
  $('#btn-start').onclick = () => { if (introMode === 'zones') return openZonesIntro(); if (introMode === 'face' && faceSupported()) return openFaceIntro(); exitFaceMode(); startCamera(); };
  $('#btn-shutter').onclick = captureFromVideo;
  $('#btn-flip').onclick = () => { facing = facing === 'environment' ? 'user' : 'environment'; startCamera(); };
  $('#btn-torch').onclick = async () => {
    const t = stream && stream.getVideoTracks()[0]; if (!t) return;
    torchOn = !torchOn; try { await t.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch (e) { torchOn = false; toast('조명을 켤 수 없어요'); }
  };
  $('#btn-cam-close').onclick = $('#btn-cam-back').onclick = () => { stopCamera(); if (zonesMode && zoneSession) { const s = zoneSession, r = s.res[s.steps[s.idx].key]; if (s.faceStep) { exitFaceMode(); $('#screen-camera').classList.add('zone-mode'); s.faceStep = false; return finishZones(); } if (r) return renderZoneStep(); exitZonesMode(); return openZonesIntro(); } if (faceMode) show('face-intro'); else show('intro'); };
  ['#file-input', '#file-input2', '#file-input3', '#face-file'].forEach((id) => { const el = $(id); if (el) el.onchange = onFile; });
  $('#btn-copy-link').onclick = copyLink;
  $('#btn-cam-retry').onclick = startCamera;
  $('#tap-to-play').onclick = () => { const v = $('#video'); v.play().then(() => ($('#tap-to-play').hidden = true)).catch(() => camError('unknown')); };
  setupInappBanner();
  const gl = document.querySelector('.guide-link');
  if (gl) gl.onclick = (e) => { e.preventDefault(); const g = $('#guide-card'); g.scrollIntoView({ behavior: 'smooth', block: 'start' }); g.setAttribute('tabindex', '-1'); try { g.focus({ preventScroll: true }); } catch (x) {} };
  // 안드로이드 뒤로가기: 앱을 닫지 않고 처음 화면으로

  // ---------- v1.5.0 매장 안정화: 오류 복구 · 자동 초기화 · 하단 고정 버튼 ----------
  function activeId() { const a = document.querySelector('.screen.active'); return a ? a.id.replace('screen-', '') : 'intro'; }
  function onScreen(id, fn) { return function () { if (activeId() === id) return fn.apply(this, arguments); }; } // 연타·늦은 탭 방지
  // 오류 → 빈 화면 대신 안내 후 처음으로
  let fatalCount = 0;
  function handleFatal(err) {
    console.error('[recover]', err);
    busy = false; reportOpening = false;
    try { stopCamera(); } catch (e) {}
    stopIdle();
    $('#recover').hidden = false;
    try { $('#btn-recover').focus(); } catch (e) {}
  }
  window.addEventListener('error', (e) => {
    if (!e || e.target !== window && e.target && e.target.nodeType) return; // 리소스 로드 실패는 각 기능에서 처리
    const f = e.filename || '', m = String(e.message || '');
    if (/^Script error\.?$/.test(m) || /ResizeObserver loop/.test(m) || (f && f.indexOf(location.origin) !== 0)) return;
    handleFatal(e.error || m);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    if (r && /AbortError|NotAllowedError|NotSupportedError/.test(r.name || '')) return; // 동영상 재생 중단 등 무해
    handleFatal(r);
  });
  $('#btn-recover').onclick = () => {
    $('#recover').hidden = true; fatalCount++;
    if (fatalCount >= 3) { try { location.reload(); } catch (e) {} return; } // 반복되면 새로 불러오기
    try { nextCustomer(); } catch (e) { location.reload(); }
  };
  // 분석이 멈춘 경우 감시 (진행 표시가 60초 이상 변하지 않으면 복구)
  let lastProgress = 0, watchT = 0;
  faceListeners.push(() => { lastProgress = Date.now(); });
  function armWatchdog() {
    clearInterval(watchT); lastProgress = Date.now();
    watchT = setInterval(() => {
      if (activeId() !== 'analyzing') return clearInterval(watchT);
      if (Date.now() - lastProgress > WATCH_MS) { clearInterval(watchT); handleFatal(new Error('analysis stalled')); }
    }, 2000);
  }
  let WATCH_MS = 60000;
  // 사용하지 않으면 자동으로 처음으로 (공용 기기 개인정보 보호)
  const IDLE = { ms: 90000, sec: 15 };
  const IDLE_SCREENS = ['result', 'invalid', 'face', 'zones', 'report', 'zone-step', 'zones-intro', 'face-intro', 'camera', 'staff', 'staff-pin'];
  let idleT = 0, cdT = 0, cdLeft = 0;
  function armIdle() {
    clearTimeout(idleT);
    if (!IDLE.ms || !$('#idle').hidden || IDLE_SCREENS.indexOf(activeId()) < 0) return; // 직원 설정에서 '끔'
    idleT = setTimeout(startCountdown, IDLE.ms);
  }
  function startCountdown() {
    if (busy || IDLE_SCREENS.indexOf(activeId()) < 0 || !$('#recover').hidden) return armIdle();
    cdLeft = IDLE.sec; $('#idle').hidden = false; idleTick(); clearInterval(cdT); cdT = setInterval(idleTick, 1000);
    try { $('#btn-idle-stay').focus(); } catch (e) {}
  }
  function idleTick() { $('#idle-sec').textContent = cdLeft; if (cdLeft-- <= 0) { stopIdle(); nextCustomer(); } }
  function stopIdle() { clearInterval(cdT); clearTimeout(idleT); $('#idle').hidden = true; }
  $('#btn-idle-stay').onclick = () => { stopIdle(); armIdle(); };
  $('#btn-idle-reset').onclick = () => { stopIdle(); nextCustomer(); };
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((ev) => document.addEventListener(ev, (e) => {
    if ($('#idle').hidden) armIdle();
    else if (!e.target.closest || !e.target.closest('#idle .btn')) { stopIdle(); armIdle(); } // 카운트다운 중 아무 곳이나 누르면 계속
  }, { passive: true, capture: true }));
  // 긴 결과 화면: 원래 버튼 묶음이 안 보일 때만 하단에 '처음으로 / 리포트' 고정
  const DOCK_SCREENS = { result: '#screen-result .actions.sticky', face: '#screen-face .actions.sticky', zones: '#screen-zones .actions.sticky' };
  let dockVisible = {}, homeArmed = 0;
  function updateDock() {
    const id = activeId(), sel = DOCK_SCREENS[id], d = $('#dock');
    let on = !!sel && !!current && $('#idle').hidden;
    if (on && id === 'result' && current.result && current.result.invalid) on = false;
    if (on && id === 'face' && current.face && current.face.invalid) on = false;
    if (on && dockVisible[id]) on = false;
    if (on) { const a = $(sel), r = a.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) on = false; }
    d.hidden = !on; document.body.classList.toggle('has-dock', on);
    if (!on) disarmHome();
  }
  function disarmHome() { homeArmed = 0; const b = $('#dock-home'); b.textContent = '처음으로'; b.classList.remove('armed'); }
  if (window.IntersectionObserver) {
    const io = new IntersectionObserver((es) => { es.forEach((e) => { const s = e.target.closest('.screen'); if (s) dockVisible[s.id.replace('screen-', '')] = e.isIntersecting; }); updateDock(); });
    Object.keys(DOCK_SCREENS).forEach((k) => io.observe($(DOCK_SCREENS[k])));
  }
  window.addEventListener('scroll', () => { if (!window.IntersectionObserver) updateDock(); }, { passive: true });
  $('#dock-report').onclick = () => openReport();
  // 결과를 지우는 버튼이라 한 번 더 눌러야 실행 (실수 방지)
  $('#dock-home').onclick = () => {
    const b = $('#dock-home');
    if (!homeArmed) { homeArmed = setTimeout(disarmHome, 3000); b.textContent = '한 번 더 누르면 처음으로'; b.classList.add('armed'); return; }
    clearTimeout(homeArmed); disarmHome(); nextCustomer();
  };
  // 첫 화면 이후 리포트 모듈 미리 불러오기 (배포 중간 버전 섞임 방지)
  window.addEventListener('load', () => setTimeout(() => { loadReportLib().catch(() => {}); }, 2500));

  // ---------- v1.6.0 인쇄 (리포트 A4 페이지만) ----------
  let printMoved = false;
  document.body.appendChild($('#print-root')); // body 바로 아래로 (인쇄 시 나머지는 모두 숨김)
  function preparePrint() {
    if (printMoved || !reportPages || activeId() !== 'report') return false;
    const root = $('#print-root'); reportPages.forEach((c) => root.appendChild(c)); // 캔버스를 그대로 옮김 (이미지 로딩 없이 즉시)
    document.documentElement.classList.add('printing'); printMoved = true; return true;
  }
  function restorePrint() {
    if (!printMoved) return; printMoved = false;
    document.documentElement.classList.remove('printing');
    const pv = $('#rep-preview'), root = $('#print-root');
    if (reportPages) reportPages.forEach((c) => pv.appendChild(c));
    root.innerHTML = '';
  }
  window.addEventListener('beforeprint', preparePrint); // 브라우저 메뉴로 인쇄해도 리포트만
  window.addEventListener('afterprint', restorePrint);
  $('#btn-rep-print').onclick = () => reportAction('#btn-rep-print', '인쇄 준비 중…', async () => {
    preparePrint();
    try { window.print(); } catch (e) { restorePrint(); throw e; }
    if (!('onafterprint' in window)) setTimeout(restorePrint, 1500);
  });

  // ---------- v1.6.0 촬영 전 조명 경고 ----------
  let lightState = 'ok', lightBad = 0, lightGood = 0, lightOverride = null, shootConfirmed = false;
  const LIGHT_MSG = {
    dark: ['조명이 어두워요', '밝은 곳으로 이동해 주세요', '어두운 채로 촬영할까요?', '조명이 어두우면 결과가 부정확하거나 측정할 수 없는 사진이 될 수 있어요.'],
    bright: ['빛이 너무 강해요', '직사광선을 피해 고르게 밝은 곳에서 찍어 주세요', '빛이 강한 채로 촬영할까요?', '빛 반사가 심하면 피부결과 유분이 정확하게 측정되지 않을 수 있어요.'],
    backlit: ['역광이에요', '창문·조명을 등지지 말고 빛을 마주 보고 찍어 주세요', '역광인 채로 촬영할까요?', '얼굴이 어둡게 찍혀 결과가 부정확할 수 있어요.'],
  };
  function setLight(st) {
    lightState = st; const w = $('#light-warn'), on = st !== 'ok';
    w.hidden = !on; w.dataset.state = st;
    if (on) { $('#light-warn-title').textContent = LIGHT_MSG[st][0]; $('#light-warn-text').textContent = LIGHT_MSG[st][1]; }
    $('#btn-lw-torch').hidden = !(st === 'dark' && !$('#btn-torch').hidden && !torchOn);
    $('#btn-shutter').classList.toggle('dim', on);
    $('#btn-shutter').setAttribute('aria-label', on ? '촬영 (' + LIGHT_MSG[st][0] + ')' : '촬영');
  }
  function resetLight() { lightBad = lightGood = 0; shootConfirmed = false; setLight('ok'); $('#shoot-confirm').hidden = true; }
  function lightVerdict(st) { // 깜빡임 방지: 2회 연속일 때만 바꿈
    if (lightOverride) st = lightOverride;
    if (st === 'ok') { lightGood++; lightBad = 0; if (lightGood >= 2 && lightState !== 'ok') setLight('ok'); }
    else { lightBad++; lightGood = 0; if ((lightBad >= 2 || lightOverride) && lightState !== st) setLight(st); }
  }
  function askShootConfirm() {
    const m = LIGHT_MSG[lightState] || LIGHT_MSG.dark;
    $('#sc-title').textContent = m[2]; $('#sc-desc').textContent = m[3];
    $('#shoot-confirm').hidden = false; try { $('#btn-sc-cancel').focus(); } catch (e) {}
  }
  $('#btn-sc-cancel').onclick = () => { $('#shoot-confirm').hidden = true; };
  $('#btn-sc-ok').onclick = () => { $('#shoot-confirm').hidden = true; shootConfirmed = true; captureFromVideo(); };
  $('#btn-lw-torch').onclick = () => { $('#btn-torch').click(); setTimeout(() => setLight(lightState), 300); };

  // ---------- v1.6.0 직원 설정 (PIN 잠금 · 기기 설정) ----------
  // 매장 기기 설정만 저장 (고객 정보 아님). 고객 세션 초기화로 지워지지 않음.
  const STAFF_KEY = 'howStaff.v1', LOCK_KEY = 'howStaff.lock';
  const STAFF_DEF = { idle: 90, cd: 15, mode: 'quick', store: '', storeIntro: false, pin: null }; // pin null = 기본 0000
  function loadStaff() { try { return Object.assign({}, STAFF_DEF, JSON.parse(localStorage.getItem(STAFF_KEY) || 'null') || {}); } catch (e) { return Object.assign({}, STAFF_DEF); } }
  let staff = loadStaff(), staffUnlocked = false, introMode = 'quick';
  function saveStaff() { try { localStorage.setItem(STAFF_KEY, JSON.stringify(staff)); } catch (e) { toast('설정을 저장하지 못했어요'); } applyStaff(); }
  function applyStaff() {
    IDLE.ms = staff.idle * 1000; IDLE.sec = staff.cd; armIdle();
    const s = $('#intro-store'); s.textContent = staff.store; s.hidden = !(staff.storeIntro && staff.store);
    if (activeId() === 'intro') applyIntroMode();
  }
  function applyIntroMode() {
    introMode = staff.mode === 'face' && !faceSupported() ? 'quick' : staff.mode;
    markIntroMode();
  }
  function markIntroMode() {
    [['quick', '#btn-mode-quick'], ['zones', '#btn-zones-mode'], ['face', '#btn-face-mode']].forEach((q) => { const b = $(q[1]), on = q[0] === introMode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    $('#btn-start').textContent = introMode === 'zones' ? '부위별 종합 시작하기' : introMode === 'face' ? '얼굴 전체 분석 시작하기' : '측정 시작하기';
  }
  // SHA-256 (SubtleCrypto, 없으면 JS 구현)
  function sha256js(str) {
    const b = unescape(encodeURIComponent(str)), K = [], H = [1779033703, -1150833019, 1013904242, -1521486534, 1359893119, -1694144372, 528734635, 1541459225];
    let n = 2, c = 0; while (c < 64) { let p = true; for (let i = 2; i * i <= n; i++) if (n % i === 0) { p = false; break; } if (p) K[c++] = (Math.pow(n, 1 / 3) % 1) * 4294967296 | 0; n++; }
    const w = [], l = b.length * 8, words = [];
    for (let i = 0; i < b.length; i++) words[i >> 2] |= b.charCodeAt(i) << (24 - (i % 4) * 8);
    words[b.length >> 2] |= 0x80 << (24 - (b.length % 4) * 8);
    words[(((b.length + 8) >> 6) << 4) + 15] = l;
    for (let j = 0; j < words.length; j += 16) {
      let [a, bb, cc, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        if (i < 16) w[i] = words[j + i] | 0;
        else { const x = w[i - 15], y = w[i - 2]; w[i] = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w[i - 16] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + w[i - 7] | 0; }
        const t1 = h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i] | 0;
        const t2 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & bb) ^ (a & cc) ^ (bb & cc)) | 0;
        h = g; g = f; f = e; e = d + t1 | 0; d = cc; cc = bb; bb = a; a = t1 + t2 | 0;
      }
      H[0] = H[0] + a | 0; H[1] = H[1] + bb | 0; H[2] = H[2] + cc | 0; H[3] = H[3] + d | 0; H[4] = H[4] + e | 0; H[5] = H[5] + f | 0; H[6] = H[6] + g | 0; H[7] = H[7] + h | 0;
    }
    return H.map((v) => ('00000000' + (v >>> 0).toString(16)).slice(-8)).join('');
  }
  async function sha256(str) {
    try {
      if (window.crypto && crypto.subtle && window.TextEncoder) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.prototype.map.call(new Uint8Array(buf), (x) => ('0' + x.toString(16)).slice(-2)).join('');
      }
    } catch (e) {}
    return sha256js(str);
  }
  const pinHash = (pin) => sha256('how-staff-pin:' + pin);
  async function pinOk(pin) { return staff.pin ? (await pinHash(pin)) === staff.pin : pin === '0000'; }
  function getLock() { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null') || { n: 0, until: 0 }; } catch (e) { return { n: 0, until: 0 }; } }
  function setLock(l) { try { if (!l.n && !l.until) localStorage.removeItem(LOCK_KEY); else localStorage.setItem(LOCK_KEY, JSON.stringify(l)); } catch (e) {} }
  let pinMode = 'enter', pinBuf = '', pinNew = '', pinLockT = 0, pinChecking = false;
  const PIN_TITLE = { enter: 'PIN 4자리를 입력해 주세요', new1: '새 PIN 4자리를 입력해 주세요', new2: '새 PIN을 한 번 더 입력해 주세요' };
  function openStaffPin(mode) {
    stopIdle(); staffUnlocked = mode === 'new1' && staffUnlocked;
    pinMode = mode || 'enter'; pinBuf = ''; pinNew = '';
    show('staff-pin'); renderPin(''); $('#btn-pin-later').hidden = true;
    lockTick();
  }
  function renderPin(msg, bad) {
    $('#pin-title').textContent = PIN_TITLE[pinMode]; $('#pin-kicker').textContent = pinMode === 'enter' ? 'Staff only' : 'Change PIN';
    if (msg != null) { $('#pin-msg').textContent = msg; $('#pin-msg').classList.toggle('bad', !!bad); }
    document.querySelectorAll('#pin-dots i').forEach((d, i) => d.classList.toggle('on', i < pinBuf.length));
    if (bad) { const dots = $('#pin-dots'); dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); }
  }
  function lockTick() {
    clearInterval(pinLockT);
    const upd = () => {
      const l = getLock(), left = Math.ceil((l.until - Date.now()) / 1000), locked = pinMode === 'enter' && left > 0;
      document.querySelectorAll('#pin-pad button').forEach((b) => { if (b.dataset.k !== 'cancel') b.disabled = locked; });
      if (locked) $('#pin-msg').textContent = `잠시 후 다시 시도해 주세요 (${left}초)`;
      else { if (l.until) { setLock({ n: 0, until: 0 }); renderPin(''); } clearInterval(pinLockT); }
      return locked;
    };
    if (upd()) pinLockT = setInterval(upd, 500);
  }
  async function pinComplete() {
    const pin = pinBuf; pinBuf = '';
    if (pinMode === 'enter') {
      pinChecking = true; const good = await pinOk(pin); pinChecking = false;
      if (!good) {
        const l = getLock(); l.n++;
        if (l.n >= 5) { setLock({ n: 0, until: Date.now() + 30000 }); renderPin('', true); return lockTick(); }
        setLock(l); return renderPin(`PIN이 맞지 않아요 (${l.n}/5)`, true);
      }
      setLock({ n: 0, until: 0 }); staffUnlocked = true;
      if (!staff.pin) { pinMode = 'new1'; renderPin('기본 PIN(0000)을 사용 중이에요. 고객이 설정을 바꾸지 않도록 새 PIN으로 바꿔 주세요.'); $('#btn-pin-later').hidden = false; return; }
      return openStaff();
    }
    if (pinMode === 'new1') {
      if (pin === '0000') return renderPin('0000은 기본 PIN이라 쓸 수 없어요. 다른 숫자를 입력해 주세요.', true);
      pinNew = pin; pinMode = 'new2'; return renderPin('');
    }
    if (pinMode === 'new2') {
      if (pin !== pinNew) { pinMode = 'new1'; pinNew = ''; return renderPin('두 번 입력한 PIN이 달라요. 처음부터 다시 입력해 주세요.', true); }
      staff.pin = await pinHash(pin); saveStaff(); toast('PIN을 바꿨어요'); return openStaff();
    }
  }
  function pinKey(k) {
    if (activeId() !== 'staff-pin' || pinChecking) return;
    if (k === 'cancel') { if (pinMode !== 'enter' && staffUnlocked) return openStaff(); return show('intro'); }
    if (pinMode === 'enter' && getLock().until > Date.now()) return;
    if (k === 'del') { pinBuf = pinBuf.slice(0, -1); return renderPin(null); }
    if (!/^\d$/.test(k) || pinBuf.length >= 4) return;
    pinBuf += k; renderPin(pinBuf.length === 1 ? '' : null);
    if (pinBuf.length === 4) setTimeout(pinComplete, 120);
  }
  $('#pin-pad').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pinKey(b.dataset.k); });
  document.addEventListener('keydown', (e) => { if (activeId() !== 'staff-pin') return; if (/^\d$/.test(e.key)) pinKey(e.key); else if (e.key === 'Backspace') pinKey('del'); else if (e.key === 'Escape') pinKey('cancel'); });
  $('#btn-pin-later').onclick = () => openStaff();
  $('#btn-pin-home').onclick = () => { staffUnlocked = false; show('intro'); };
  function segSet(id, v) { document.querySelectorAll(id + ' button').forEach((b) => { const on = b.dataset.v === String(v); b.classList.toggle('on', on); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', on ? 'true' : 'false'); }); }
  function openStaff() {
    if (!staffUnlocked) return openStaffPin();
    show('staff');
    segSet('#st-idle', staff.idle); segSet('#st-cd', staff.cd); segSet('#st-mode', staff.mode);
    $('#st-store').value = staff.store; $('#st-store-intro').checked = !!staff.storeIntro;
    $('#staff-defpin').hidden = !!staff.pin;
    const fb = document.querySelector('#st-mode [data-v="face"]'); fb.disabled = !faceSupported();
    disarmReset();
  }
  [['#st-idle', 'idle', Number], ['#st-cd', 'cd', Number], ['#st-mode', 'mode', String]].forEach((q) => {
    $(q[0]).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.disabled || !staffUnlocked) return; staff[q[1]] = q[2](b.dataset.v); segSet(q[0], staff[q[1]]); saveStaff(); });
  });
  $('#st-store').addEventListener('input', () => { if (!staffUnlocked) return; staff.store = $('#st-store').value.trim().slice(0, 24); saveStaff(); });
  $('#st-store-intro').onchange = () => { if (!staffUnlocked) return; staff.storeIntro = $('#st-store-intro').checked; saveStaff(); };
  $('#btn-staff-pin').onclick = $('#btn-staff-pin2').onclick = () => openStaffPin('new1');
  let resetArmed = 0;
  function disarmReset() { clearTimeout(resetArmed); resetArmed = 0; $('#btn-staff-reset').textContent = '설정을 기본값으로 되돌리기 (PIN 유지)'; }
  $('#btn-staff-reset').onclick = () => {
    if (!resetArmed) { resetArmed = setTimeout(disarmReset, 3000); $('#btn-staff-reset').textContent = '한 번 더 누르면 기본값으로 되돌려요'; return; }
    const pin = staff.pin; staff = Object.assign({}, STAFF_DEF, { pin }); saveStaff(); toast('설정을 기본값으로 되돌렸어요'); openStaff();
  };
  $('#btn-staff-done').onclick = $('#btn-staff-home').onclick = () => { staffUnlocked = false; show('intro'); toast('설정을 저장하고 잠갔어요'); };
  // 숨은 진입: 첫 화면 로고 2초 길게 누르기 · 버전 표시 5번 탭
  (function hiddenEntry() {
    const seal = document.querySelector('.hero-seal'); let t = 0;
    const clear = () => { clearTimeout(t); t = 0; };
    seal.addEventListener('pointerdown', () => { clear(); t = setTimeout(() => { t = 0; if (activeId() === 'intro') openStaffPin(); }, 2000); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => seal.addEventListener(ev, clear));
    seal.addEventListener('contextmenu', (e) => e.preventDefault());
    let taps = 0, tapT = 0;
    document.querySelectorAll('.js-ver').forEach((b) => (b.onclick = () => {
      taps++; clearTimeout(tapT);
      if (taps >= 5) { taps = 0; return openStaffPin(); }
      tapT = setTimeout(() => { if (taps === 1) checkForUpdate(true); taps = 0; }, 700);
    }));
  })();
  $('#btn-mode-quick').onclick = () => { introMode = 'quick'; markIntroMode(); };
  applyStaff(); applyIntroMode();

  window.addEventListener('popstate', () => {
    const onIntro = $('#screen-intro').classList.contains('active');
    if (show._expectPop) { show._expectPop = false; if (!onIntro) try { history.pushState({ app: 1 }, ''); } catch (e) {} return; }
    if (onIntro) return;
    const id = activeId();
    if (id === 'analyzing') { try { history.pushState({ app: 1 }, ''); } catch (e) {} return; } // 분석 중에는 무시
    if (id === 'report' && current) return show(current.mode === 'face' ? 'face' : current.mode === 'zones' ? 'zones' : 'result');
    if (id === 'camera') { show._pop = true; $('#btn-cam-close').click(); show._pop = false; return; }
    if (id === 'zone-step' && zoneSession) { stopCamera(); exitZonesMode(); return openZonesIntro(); }
    stopCamera(); show._pop = true; show('intro');
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') window.addEventListener('load', () => navigator.serviceWorker.register('sw.js?v=' + APP_VERSION, { updateViaCache: 'none' }).then((r) => r.update && r.update()).catch(() => {}));

  // ---------- 버전 표시 · 새로고침 · 업데이트 확인 ----------
  document.querySelectorAll('.js-ver-text').forEach((el) => (el.textContent = `v${APP_VERSION} · ${BUILD_DATE}`));
  function cmpVer(a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
    return 0;
  }
  let refreshing = false, pendingUpdate = null; // 새 버전은 다음 고객으로 넘어갈 때 자동 적용
  async function hardRefresh() {
    if (refreshing) return; refreshing = true;
    toast('최신 버전을 불러오는 중…');
    try {
      if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); }
      if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.filter((k) => k.indexOf('how-face-') !== 0).map((k) => caches.delete(k))); }
    } catch (e) {}
    stopCamera();
    const u = new URL(location.href); u.searchParams.set('r', Date.now().toString(36)); u.hash = '';
    location.replace(u.toString());
  }
  async function fetchLatest() {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('http ' + res.status);
    return res.json();
  }
  function showUpdateBanner(v) {
    $('#update-text').textContent = `새 버전(v${v})이 있어요`;
    $('#update-banner').hidden = false;
  }
  async function checkForUpdate(manual) {
    try {
      const j = await fetchLatest();
      if (j && j.version && cmpVer(j.version, APP_VERSION) > 0) { pendingUpdate = j.version; showUpdateBanner(j.version); return true; }
      if (manual) toast(`최신 버전이에요 (v${APP_VERSION})`);
    } catch (e) { if (manual) toast('지금은 업데이트를 확인할 수 없어요'); }
    return false;
  }
  window.__checkForUpdate = checkForUpdate;
  $('#btn-refresh').onclick = hardRefresh;
  $('#btn-update').onclick = hardRefresh;
  $('#btn-update-close').onclick = () => ($('#update-banner').hidden = true);
  // 정리: 새로고침용 쿼리(r)는 주소창에서 제거
  try { const u = new URL(location.href); if (u.searchParams.has('r')) { u.searchParams.delete('r'); history.replaceState(history.state, '', u.toString()); } } catch (e) {}
  window.addEventListener('load', () => setTimeout(() => checkForUpdate(false), 800));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(false); });
  $('#btn-res-home').onclick = () => show('intro');
  $('#btn-retry').onclick = () => { exitFaceMode(); startCamera(); };
  $('#btn-invalid-retry').onclick = () => { exitFaceMode(); startCamera(); };
  $('#btn-next').onclick = nextCustomer;
  $('#btn-share').onclick = shareResult;
  $('#viz-tabs').onclick = (e) => { const m = e.target.dataset && e.target.dataset.mode; if (m) setViz(m); };
  window.addEventListener('resize', () => stream && layoutGuide());
  document.addEventListener('visibilitychange', () => { if (document.hidden && stream) stopCamera(), show('intro'); });

  // 테스트용 훅 (자동 테스트에서만 사용)
  window.__skinTest = {
    recs: () => current && { care: current.care, makeup: current.makeup, tone: current.tone, season: currentSeason() },
    async analyzeUrl(url, fast = true) { const im = await loadImage(url); const r = await runAnalysis(await fromImage(im), fast); return { scores: r.scores, raw: r.raw, warnings: r.warnings, pores: r.viz.pores.length }; },
    faceSupported: () => faceSupported(),
    openReport: () => openReport(),
    reportPdfBase64: async () => { if (!reportPages) await buildReport(); const b = await reportPdfBlob(); return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }); },
    reportImageBase64: async () => { if (!reportPages) await buildReport(); const b = await reportImageBlob(); return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }); },
    reportPages: () => reportPages && reportPages.length,
    state: () => ({ current: !!current, season: seasonChoice, name: reportName, ls: (() => { try { return Object.keys(localStorage); } catch (e) { return []; } })() }),
    setSeason: (v) => { setSeasonChoice(v); },
    async zonesRun(urls, faceUrl, eye) {
      openZonesIntro(); $('#zi-eye').checked = !!eye; $('#zi-face').checked = !!faceUrl && faceSupported();
      const steps = ZONE_DEF.filter((z) => z.key !== 'eye' || eye);
      zoneSession = { steps, idx: 0, res: {}, face: null, faceCanvas: null, withFace: !!faceUrl && faceSupported(), faceStep: false }; zonesMode = true;
      for (let i = 0; i < steps.length; i++) {
        zoneSession.idx = i;
        if (urls[i]) { const im = await loadImage(urls[i]); await runZone(await fromImage(im)); } else zoneSession.res[steps[i].key] = { status: 'skipped' };
      }
      if (zoneSession.withFace) { zoneSession.faceStep = true; const im = await loadImage(faceUrl); await runFace(fromFaceImage(im), true); }
      else finishZones();
      if (!current || current.mode !== 'zones') return null;
      const Z = current.zones;
      return { overall: Z.overall, grade: Z.grade.key, best: Z.best.name, worst: Z.worst.name, type: Z.type.name, T: Z.T, U: Z.U, typeSrc: Z.typeSrc, face: !!Z.face, skipped: Z.skipped,
        zones: Z.zones.map((z) => ({ key: z.key, status: z.status, overall: z.scores && z.scores.overall, red: z.redLevel, redRel: z.redRel, shine: z.shine })), care: current.care.priorityName, headline: current.care.headline, tips: current.care.zoneTips, finish: current.makeup.finish };
    },
    setIdle: (ms, sec) => { IDLE.ms = ms; IDLE.sec = sec; armIdle(); },
    setWatch: (ms) => { WATCH_MS = ms; },
    fatal: (m) => { setTimeout(() => { throw new Error(m || 'test fatal'); }, 0); },
    camLive: () => !!stream,
    showScreen: (id) => show(id),
    light: (st) => { lightOverride = st; },
    idle: () => ({ ms: IDLE.ms, sec: IDLE.sec }),
    lightState: () => lightState,
    preparePrint: () => preparePrint(), restorePrint: () => restorePrint(),
    staff: () => JSON.parse(JSON.stringify(staff)),
    sha: async (t) => ({ js: sha256js(t), native: await sha256(t) }),
    pendingUpdate: (v) => { pendingUpdate = v; },
    zoneStepOnly: async (url, i) => { if (!zoneSession) { openZonesIntro(); zoneSession = { steps: ZONE_DEF.slice(0, 5), idx: 0, res: {}, face: null, withFace: false, faceStep: false }; zonesMode = true; } zoneSession.idx = i || 0; const im = await loadImage(url); await runZone(await fromImage(im)); return zoneSession.res[zoneSession.steps[zoneSession.idx].key].status; },
    async faceUrl(url) { const im = await loadImage(url); await runFace(fromFaceImage(im), true); const f = current.face; return f.invalid ? { invalid: true, blockers: f.blockers } : { type: f.type, summary: f.summary, t: f.tShine, u: f.uShine, compact: window.HowFaceAnalyze.compact(f), care: current.care.priorityName, finish: current.makeup.finish, season: current.tone.season }; },
  };
})();
