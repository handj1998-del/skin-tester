/* H.O.W 결과 기반 추천 (케어 · 메이크업 · 퍼스널컬러) — 클라이언트 전용, 일반적인 화장품 사용 가이드 */
(function (root) {
  'use strict';
  const NAMES = { smooth: '매끄러움', pore: '모공', lines: '잔주름' };

  // ---------- 1) 집중 케어 ----------
  const CARE = {
    pore: {
      title: '모공 · 피지 정돈',
      ingredients: [['BHA(살리실산)', '모공 속 각질·피지 정돈'], ['나이아신아마이드', '피지 밸런스·결 정돈'], ['클레이(카올린)', '과잉 피지 흡착'], ['아연(징크)', '유분 컨트롤']],
      am: '가벼운 수분 토너 → 나이아신아마이드 세럼',
      pm: 'BHA 토너 또는 세럼 (주 2~3회, 저녁)',
      weekly: ['클레이 마스크 주 1회 (T존 중심, 10분 이내)', '스팀타월로 모공을 연 뒤 저자극 클렌징'],
      avoid: ['손으로 짜거나 강하게 문지르기', '무거운 오일·두꺼운 크림의 과다 사용', '알코올이 많은 수렴 토너의 잦은 사용'],
    },
    lines: {
      title: '잔주름 · 수분 탄력',
      ingredients: [['레티놀 · 레티날', '피부결·탄력 케어 (저녁, 저농도부터)'], ['펩타이드', '탄력 보조'], ['히알루론산', '수분 채움'], ['자외선 차단제', '광노화 예방의 기본']],
      am: '히알루론산 세럼 → 보습 크림 → 자외선 차단제 넉넉히',
      pm: '레티놀 (주 2회로 시작해 천천히 늘리기) 또는 펩타이드 세럼',
      weekly: ['수분 시트마스크 또는 슬리핑팩 주 1~2회', '눈가·입가에 아이크림 소량 덧바르기'],
      avoid: ['자외선 차단제 생략', '뜨거운 물 세안·사우나 후 보습 미루기', '레티놀과 산(AHA/BHA)을 같은 날 함께 사용'],
    },
    smooth: {
      title: '피부결 · 각질 정돈',
      ingredients: [['PHA · AHA', '묵은 각질 부드럽게 정돈'], ['세라마이드', '장벽 강화'], ['판테놀', '진정·보습'], ['스쿠알란', '부드러운 유수분 보충']],
      am: '약산성 클렌저 → 판테놀 토너 → 세라마이드 크림',
      pm: 'PHA/AHA 토너 (주 1~2회) → 장벽 크림',
      weekly: ['저자극 필링 주 1회 (스크럽보다 산 각질제 권장)', '장벽 크림 두껍게 바르는 수면팩 루틴'],
      avoid: ['알갱이 스크럽으로 세게 문지르기', '여러 각질 제품을 한 번에 겹쳐 쓰기', '세안 후 보습까지 오래 비워두기'],
    },
  };
  function sortedWeak(scores) {
    return ['smooth', 'pore', 'lines'].map((k) => ({ k, v: scores[k] })).sort((a, b) => a.v - b.v);
  }
  function buildCare(scores) {
    const w = sortedWeak(scores);
    const focus = w.filter((x) => x.v < 80).map((x) => x.k);
    const mode = scores.overall >= 85 && !focus.length ? 'maintain' : scores.overall < 58 ? 'gentle' : 'focus';
    const primary = focus[0] || null, secondary = focus[1] || null;
    const P = primary ? CARE[primary] : null, S = secondary ? CARE[secondary] : null;
    const am = ['약산성 · 저자극 클렌저로 가볍게 세안'];
    if (P) am.push(P.am); else am.push('수분 토너 → 가벼운 보습 세럼');
    if (!P || primary !== 'lines') am.push('보습 크림 → 자외선 차단제 (매일, 2~3시간마다 덧바르기)');
    const pm = ['메이크업·선크림을 지우는 클렌징 (필요 시 이중 세안)'];
    if (P) pm.push(P.pm);
    if (S) pm.push(`${NAMES[secondary]} 케어는 ${primary === 'lines' || secondary === 'lines' ? '레티놀과 산 성분을 다른 날로 나눠' : '격일로 번갈아'} 사용`);
    pm.push('세라마이드 · 판테놀 보습 크림으로 마무리');
    const ingredients = [...(P ? P.ingredients : [['세라마이드', '장벽 유지'], ['히알루론산', '수분 유지'], ['자외선 차단제', '매일 기본']]), ...(S ? S.ingredients.slice(0, 2) : [])];
    const weekly = [...(P ? P.weekly : ['주 1회 수분 마스크로 컨디션 유지']), ...(S ? S.weekly.slice(0, 1) : [])];
    const avoid = [...(P ? P.avoid : ['과한 각질 제거로 장벽 약화시키기']), ...(S ? S.avoid.slice(0, 1) : []), '새 활성 성분은 하나씩, 귀 뒤 패치 테스트 후 시작'];
    const headline = mode === 'maintain' ? '지금의 결을 유지하는 기본 루틴' : mode === 'gentle' ? `장벽을 먼저 다진 뒤 ${NAMES[primary] || '결'} 케어를 천천히` : `${NAMES[primary]} 중심의 집중 루틴`;
    return { mode, primary, secondary, priorityName: primary ? NAMES[primary] : '유지 관리', title: P ? P.title : '컨디션 유지', headline, am, pm, ingredients, weekly, avoid };
  }

  // ---------- 2) 메이크업 ----------
  function buildMakeup(scores) {
    const w = sortedWeak(scores), low = w[0];
    const poreWeak = scores.pore < 75, linesWeak = scores.lines < 75, roughWeak = scores.smooth < 75;
    let primer, finish, finishWhy;
    if (poreWeak && !linesWeak) primer = '모공 블러 프라이머 — T존·볼 안쪽에만 소량, 두드려서 메우기';
    else if (linesWeak || roughWeak) primer = '수분 · 결 정돈 프라이머 — 얼굴 전체에 얇게, 건조한 부위 중심';
    else primer = '톤업 또는 라이트 수분 프라이머 — 필요한 부위만 가볍게';
    if (linesWeak) { finish = '세미 글로우 · 듀이'; finishWhy = '매트한 베이스는 잔주름에 끼기 쉬워요. 촉촉한 마무리가 결을 부드럽게 보여줘요.'; }
    else if (poreWeak) { finish = '세미 매트'; finishWhy = '빛 반사를 줄여 모공이 덜 도드라져 보여요. 완전 매트보다 세미 매트가 자연스러워요.'; }
    else if (roughWeak) { finish = '새틴 (세미 글로우)'; finishWhy = '은은한 윤기가 요철을 흐리게 보이게 해요. 각질 부위는 보습 후 얇게.'; }
    else { finish = '글로우 · 얇은 커버'; finishWhy = '결이 고른 편이라 얇은 베이스로 피부 결을 살리는 게 좋아요.'; }
    const tips = ['베이스는 얇게 여러 번 — 한 번에 두껍게 올리지 않기'];
    if (poreWeak) tips.push('모공 부위는 퍼프로 문지르지 말고 눌러서(프레싱) 밀착', '파우더는 T존·코 옆에만 브러시로 가볍게');
    if (linesWeak) tips.push('눈가·입가는 파우더 생략 또는 극소량, 미스트로 마무리', '컨실러는 묽은 제형을 얇게, 손가락 온기로 두드리기');
    if (roughWeak) tips.push('각질 부위는 메이크업 전 보습 크림을 충분히 흡수시키기', '스펀지를 살짝 적셔 두드리면 들뜸이 줄어요');
    if (!poreWeak && !linesWeak && !roughWeak) tips.push('쿠션이나 스킨틴트로 가볍게, 필요한 곳만 컨실러');
    tips.push('수정 화장은 유분을 먼저 눌러 닦은 뒤 얇게 덧바르기');
    return { primer, finish, finishWhy, tips, focus: low.v < 75 ? NAMES[low.k] : null };
  }

  // ---------- 3) 퍼스널 컬러 (추정) ----------
  function srgbToLab(r, g, b) {
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const R = lin(r), G = lin(g), B = lin(b);
    const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return { L: 116 * f(Y) - 16, a: 500 * (f(X) - f(Y)), b: 200 * (f(Y) - f(Z)) };
  }
  function estimateTone(rgb, warnings) {
    const lab = srgbToLab(rgb[0], rgb[1], rgb[2]);
    const hue = (Math.atan2(lab.b, lab.a) * 180) / Math.PI, chroma = Math.hypot(lab.a, lab.b);
    const undertone = hue >= 56 ? 'warm' : hue <= 50 ? 'cool' : (hue >= 53 ? 'warm' : 'cool');
    const neutral = hue > 50 && hue < 56;
    const light = lab.L >= 62;
    const season = undertone === 'warm' ? (light && hue < 70 ? 'spring' : 'autumn') : (light && chroma < 24 ? 'summer' : 'winter');
    let confidence = neutral ? 'low' : 'medium';
    if ((warnings && warnings.length) || chroma < 8 || chroma > 45) confidence = 'low';
    return { L: lab.L, a: lab.a, b: lab.b, hue, chroma, undertone, neutral, season, confidence };
  }
  const SEASONS = {
    spring: { name: '봄 웜', en: 'Spring Warm', desc: '밝고 맑은 웜 톤. 생기 있는 코랄·피치 계열이 잘 어울려요.',
      foundation: [['라이트 아이보리 (웜)', '#f3dcc4'], ['웜 베이지', '#e9c7a6']],
      lip: [['코랄', '#ef7a66'], ['살몬 핑크', '#f2998a'], ['피치', '#f2a582'], ['오렌지 레드', '#e2553f']],
      blush: [['피치', '#f6b197'], ['코랄', '#f0907a'], ['애프리콧', '#f2b48f']],
      eye: [['샴페인 골드', '#e6cf9f'], ['피치 브라운', '#c48d6b'], ['웜 카멜', '#b5825a']],
      avoid: [['푸시아', '#c2185b'], ['쿨 그레이', '#8e9096'], ['블랙', '#1f1d1d']] },
    summer: { name: '여름 쿨', en: 'Summer Cool', desc: '부드럽고 맑은 쿨 톤. 로즈·라벤더처럼 차분한 파스텔이 잘 어울려요.',
      foundation: [['핑크 베이지', '#efd3c8'], ['라이트 뉴트럴', '#e6cbbd']],
      lip: [['로즈 핑크', '#d47b91'], ['라벤더 핑크', '#c48ba6'], ['소프트 베리', '#b0566f'], ['말린 장미', '#bd7c80']],
      blush: [['쿨 핑크', '#efa9b6'], ['라벤더', '#d6b3cf'], ['로즈', '#e29aa2']],
      eye: [['토프', '#a59a8f'], ['로즈 브라운', '#a57b77'], ['라벤더 그레이', '#a8a1b4']],
      avoid: [['오렌지', '#e97a28'], ['골드', '#c7a02b'], ['머스터드', '#c49a2e']] },
    autumn: { name: '가을 웜', en: 'Autumn Warm', desc: '깊고 차분한 웜 톤. 브릭·테라코타·카키 같은 깊은 색이 잘 어울려요.',
      foundation: [['웜 베이지', '#e0bd9a'], ['허니 베이지', '#d3a77f']],
      lip: [['브릭 레드', '#a4432f'], ['테라코타', '#bc634a'], ['칠리', '#9b3c2d'], ['누드 브라운', '#a46b56']],
      blush: [['테라코타', '#cc8466'], ['브론즈 피치', '#c58f6c'], ['머스크 로즈', '#bf7b6b']],
      eye: [['카키', '#7b7550'], ['브론즈', '#986b40'], ['딥 브라운', '#5c3e2c'], ['올리브 골드', '#9e8b4b']],
      avoid: [['네온 핑크', '#ff4fa3'], ['아이시 블루', '#bfe3f2'], ['실버', '#c3c4c7']] },
    winter: { name: '겨울 쿨', en: 'Winter Cool', desc: '선명하고 대비가 강한 쿨 톤. 체리·플럼처럼 또렷한 색이 잘 어울려요.',
      foundation: [['쿨 아이보리', '#f0d9cf'], ['쿨 뉴트럴 베이지', '#dcbfb0']],
      lip: [['체리 레드', '#b1163e'], ['푸시아', '#bf1d5e'], ['플럼', '#7a2e4f'], ['블루 레드', '#bd122e']],
      blush: [['쿨 로즈', '#dd7b96'], ['베리', '#b5486a'], ['아이시 핑크', '#efb9c6']],
      eye: [['차콜', '#3e3c41'], ['실버 그레이', '#a6a8ad'], ['버건디', '#6c2337'], ['네이비', '#2e3656']],
      avoid: [['오렌지 브라운', '#b2661f'], ['카멜', '#bf9a6b'], ['머스터드', '#c49a2e']] },
  };

  root.HowRecommend = { buildCare, buildMakeup, estimateTone, srgbToLab, SEASONS, NAMES };
})(typeof window !== 'undefined' ? window : globalThis);
