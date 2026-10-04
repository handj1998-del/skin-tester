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

  // ---------- 4) 얼굴 전체 분석(붉은기 · 유분) 기반 케어/메이크업 ----------
  // f = { type: 'oily'|'combo'|'drynormal', tLevel, uLevel, redLevel(볼 최대 0~2), redZones:[이름], texture }
  function faceFocus(f) {
    const red = f.redLevel >= 2 || (f.redZones && f.redZones.length > 0);
    const oil = f.type === 'oily' || f.tLevel >= 2;
    if (red && oil) return 'redoil';
    if (red) return 'redness';
    if (oil || f.type === 'combo') return f.type === 'combo' ? 'combo' : 'oil';
    return f.redLevel === 1 ? 'calm' : 'dry';
  }
  const FACE_CARE = {
    redness: { name: '붉은기 진정', headline: '자극을 줄이고 장벽을 채우는 진정 루틴',
      am: ['미온수로 가볍게 세안 (뜨거운 물 피하기)', '판테놀·병풀(센텔라) 진정 토너를 손으로 눌러 흡수', '세라마이드 보습제 → 무기자차 등 순한 자외선 차단제'],
      pm: ['약산성 저자극 클렌저로 짧게 세안', '진정 앰플(마데카소사이드·알란토인) 얇게', '세라마이드·스쿠알란 크림으로 마무리'],
      ing: [['판테놀', '진정·보습'], ['병풀(센텔라)·마데카소사이드', '붉은기 진정'], ['세라마이드', '장벽 강화'], ['알란토인', '자극 완화'], ['나이아신아마이드(저농도)', '톤·장벽 보조 — 자극 시 중단']],
      weekly: ['진정 시트 마스크 주 2~3회 (냉장 보관하면 더 시원해요)', '각질 케어는 쉬거나 PHA로 주 1회 이하'],
      avoid: ['스크럽·강한 필링, 고농도 산(AHA/BHA) 연속 사용', '알코올·강한 향료가 많은 제품', '사우나·뜨거운 샤워 직후 바로 화장품 여러 겹', '새 제품은 귀 뒤 패치 테스트 후 사용'] },
    oil: { name: '유분 밸런스', headline: '번들거림을 정돈하되 속건조는 막는 루틴',
      am: ['약산성 젤 클렌저로 세안', '나이아신아마이드 세럼', '가벼운 수분 젤 → 산뜻한 자외선 차단제'],
      pm: ['메이크업·선크림 클렌징 후 약산성 세안', 'BHA(살리실산) 토너 주 2~3회', '오일프리 수분 젤 크림'],
      ing: [['BHA(살리실산)', '모공 속 피지·각질 정돈'], ['나이아신아마이드', '피지 밸런스'], ['아연 PCA', '번들거림 완화'], ['클레이(카올린)', '과잉 피지 흡착'], ['히알루론산', '가벼운 수분']],
      weekly: ['클레이 마스크 주 1~2회 (10분 이내)', '낮에는 기름종이로 눌러서 유분만 덜어내기'],
      avoid: ['하루 3회 이상 과도한 세안', '유분 많은 크림·오일 과다 사용', '수분 크림을 건너뛰기 (속건조로 피지가 늘 수 있어요)'] },
    combo: { name: 'T존 유분 · 볼 보습', headline: '부위별로 다르게 — T존은 산뜻하게, 볼은 촉촉하게',
      am: ['약산성 클렌저로 세안', '나이아신아마이드 세럼은 T존 위주', 'T존엔 젤, 볼엔 크림으로 나눠 바르기 → 자외선 차단제'],
      pm: ['클렌징 후 약산성 세안', 'BHA 토너를 T존에만 주 2~3회', '볼은 세라마이드 크림으로 보습'],
      ing: [['BHA(살리실산)', 'T존 피지 정돈'], ['나이아신아마이드', '유분·결 밸런스'], ['세라마이드', '볼 보습·장벽'], ['히알루론산', '가벼운 수분']],
      weekly: ['클레이 마스크는 T존에만 주 1회', '볼은 수분 마스크 주 1~2회'],
      avoid: ['얼굴 전체에 같은 유분 조절 제품 사용', '볼까지 강하게 각질 제거', '두꺼운 크림을 T존에 듬뿍'] },
    redoil: { name: '진정 + 유분 정돈', headline: '자극 없이 피지를 정돈하는 순한 루틴',
      am: ['미온수 + 약산성 젤 클렌저', '판테놀·병풀 진정 토너', '가벼운 수분 젤 → 순한 자외선 차단제'],
      pm: ['저자극 클렌징', '저농도 BHA 또는 아연 PCA를 T존에만 주 1~2회', '진정 젤 크림'],
      ing: [['병풀(센텔라)', '진정'], ['판테놀', '진정·보습'], ['아연 PCA', '피지 정돈'], ['저농도 BHA', 'T존 피지 정돈 — 자극 시 중단'], ['녹차 추출물', '산뜻한 진정']],
      weekly: ['진정 마스크 주 2회, 클레이는 T존에만 주 1회 이하', '각질 케어는 PHA로 순하게'],
      avoid: ['스크럽·강한 산 연속 사용', '알코올 많은 수렴 토너', '뜨거운 물 세안'] },
    calm: { name: '컨디션 유지 · 진정', headline: '지금 균형을 지키며 가벼운 진정을 더하는 루틴',
      am: ['약산성 클렌저 세안', '진정 토너(판테놀)', '보습제 → 자외선 차단제'],
      pm: ['저자극 클렌징', '세라마이드 보습 크림'],
      ing: [['판테놀', '진정·보습'], ['세라마이드', '장벽 유지'], ['히알루론산', '수분']],
      weekly: ['진정 마스크 주 1~2회'], avoid: ['갑작스러운 고기능 제품 여러 개 동시 시작', '뜨거운 물 세안'] },
    dry: { name: '수분 · 장벽 유지', headline: '유분이 적은 편 — 수분과 장벽을 채우는 루틴',
      am: ['물 세안 또는 순한 클렌저', '히알루론산 세럼', '세라마이드 크림 → 자외선 차단제'],
      pm: ['순한 클렌징', '보습 세럼 → 크림, 건조한 부위는 스쿠알란 오일 한 방울'],
      ing: [['히알루론산', '수분 채움'], ['세라마이드', '장벽 강화'], ['스쿠알란', '유수분 보충'], ['판테놀', '보습·진정']],
      weekly: ['수분 마스크 주 2회', '각질 케어는 PHA로 주 1회 이하'],
      avoid: ['뽀득한 세정력의 클렌저', '알코올 토너', '건조한 실내에 오래 있기 (가습기 활용)'] },
  };
  function buildFaceCare(f) {
    const k = faceFocus(f), C = FACE_CARE[k];
    const am = C.am.slice(), pm = C.pm.slice();
    if (f.texture != null && f.texture < 55) pm.push('결이 고르지 않은 부위는 주 1회 PHA로 순하게 정돈');
    return { mode: k === 'dry' || k === 'calm' ? 'maintain' : 'focus', primary: k, priorityName: C.name, title: C.name, headline: C.headline,
      am, pm, ingredients: C.ing, weekly: C.weekly, avoid: C.avoid };
  }
  function buildFaceMakeup(f) {
    const k = faceFocus(f), red = k === 'redness' || k === 'redoil' || f.redLevel >= 1, tips = ['베이스는 얇게 여러 번 — 한 번에 두껍게 올리지 않기'];
    let primer, finish, finishWhy;
    if (f.type === 'oily') { primer = '피지 조절(매트) 프라이머 — T존과 코 옆 중심, 볼은 소량'; finish = '세미 매트'; finishWhy = '번들거림을 눌러주되 완전 매트보다 자연스러워 오래 가요.'; }
    else if (f.type === 'combo') { primer = 'T존엔 피지 조절 프라이머, 볼엔 수분 프라이머로 나눠 바르기'; finish = '새틴 (T존 세미 매트 + 볼 은은한 윤기)'; finishWhy = '부위별로 마무리를 달리하면 T존은 덜 번들거리고 볼은 건조해 보이지 않아요.'; }
    else { primer = '수분 · 글로우 프라이머 — 얼굴 전체 얇게'; finish = '세미 글로우 · 듀이'; finishWhy = '유분이 적은 편이라 촉촉한 마무리가 피부를 편안하고 생기 있게 보여줘요.'; }
    if (f.type === 'oily' || f.type === 'combo') tips.push('파우더는 T존·코 옆에만 브러시로 가볍게', '수정 화장 전 기름종이로 유분을 눌러 덜어내기');
    else tips.push('파우더는 생략하거나 눈 밑 번짐 방지용으로만 극소량', '스펀지를 살짝 적셔 두드리면 들뜸이 줄어요');
    if (red) tips.push('붉은 부위는 그린 계열 컬러 코렉터를 아주 소량 — 두드려 펴기', '붉은기 부위는 컨실러를 문지르지 말고 눌러서 밀착', '블러셔는 볼 붉은기가 있으면 생략하거나 뉴트럴 톤을 아주 연하게');
    else tips.push('블러셔는 볼 중앙보다 약간 위쪽에 연하게 — 생기만 더하기');
    return { primer, finish, finishWhy, tips, focus: FACE_CARE[k].name };
  }


  // ---------- 5) 부위별 종합 (여러 부위 가까이 촬영) ----------
  const SHINE_T = [1.5, 4];
  function skinTypeTU(T, U) { // 얼굴 전체 분석과 같은 기준 (광택 비율 %)
    const hi = SHINE_T[1], lo = SHINE_T[0];
    if ((T >= hi && U >= lo) || (T >= lo * 1.7 && U >= lo * 1.7)) return { key: 'oily', name: '지성 경향' };
    if (T >= lo * 1.5 && T >= U * 1.5) return { key: 'combo', name: '복합성 경향' };
    if (T >= hi) return { key: 'oily', name: '지성 경향' };
    return { key: 'drynormal', name: '건성·중성 경향' };
  }
  const ZONE_TIP = {
    smooth: '각질 정돈 + 보습 (PHA 주 1회, 세라마이드 크림)',
    pore: '모공 정돈 (BHA 주 2~3회, 나이아신아마이드)',
    lines: '수분·탄력 (히알루론산, 저농도 레티놀은 천천히)',
  };
  const uniq = (arr) => arr.filter((x, i) => arr.indexOf(x) === i);
  const head = (n) => n.split(/[\s(·]/)[0];
  const uniqBy = (arr) => arr.filter((x, i) => arr.findIndex((y) => head(y[0]) === head(x[0])) === i);
  function minKey(sc) { return sortedWeak(sc)[0].k; }
  // zones: [{ name, scores, redLevel, shineLevel }] (측정된 부위만), agg: 가중 평균 점수, fi: buildFaceCare 입력 형식
  function buildZoneCare(agg, zones, fi) {
    const base = buildCare(agg), fc = buildFaceCare(fi), k = faceFocus(fi);
    const color = ['redness', 'oil', 'combo', 'redoil'].indexOf(k) >= 0;
    const worst = zones.slice().sort((a, b) => a.scores.overall - b.scores.overall), w0 = worst[0];
    const wk = w0 ? minKey(w0.scores) : null;
    const zoneTips = worst.filter((z) => z.scores.overall < 80).slice(0, 3).map((z) => `${z.name} — ${NAMES[minKey(z.scores)]}: ${ZONE_TIP[minKey(z.scores)]}`);
    zones.filter((z) => z.redLevel >= 2).forEach((z) => zoneTips.push(`${z.name} — 붉은기: 진정 토너·판테놀, 문지르지 않기`));
    zones.filter((z) => z.shineLevel >= 2).forEach((z) => zoneTips.push(`${z.name} — 유분: 가벼운 수분 젤, 기름종이로 눌러 덜어내기`));
    const lastPm = base.pm[base.pm.length - 1], lastAvoid = base.avoid[base.avoid.length - 1];
    const am = uniq([base.am[0]].concat(color ? fc.am.slice(1, 2) : [], base.am.slice(1))).slice(0, 5);
    const pm = uniq(base.pm.slice(0, -1).concat(color ? fc.pm.slice(1, 2) : [], [lastPm])).slice(0, 6);
    const ingredients = uniqBy(base.ingredients.slice(0, 4).concat(color ? fc.ingredients.slice(0, 3) : [])).slice(0, 7);
    const weekly = uniq(base.weekly.concat(color ? fc.weekly.slice(0, 1) : [])).slice(0, 4);
    const avoid = uniq(base.avoid.slice(0, -1).concat(color ? fc.avoid.slice(0, 1) : [], [lastAvoid])).slice(0, 6);
    const needFocus = w0 && w0.scores.overall < 80;
    const priorityName = needFocus ? `${w0.name} · ${NAMES[wk]}` : color ? fc.priorityName : base.priorityName;
    const headline = needFocus ? `가장 낮은 ${w0.name}(${w0.scores.overall}점)의 ${NAMES[wk]} 케어를 먼저${color ? ', ' + fc.priorityName + ' 함께' : ''}` : color ? fc.headline : base.headline;
    return { mode: needFocus || color ? 'focus' : base.mode, primary: base.primary, secondary: base.secondary, colorFocus: color ? k : null, priorityName, title: priorityName, headline, am, pm, ingredients, weekly, avoid, zoneTips };
  }
  function buildZoneMakeup(agg, fi) {
    const b = buildMakeup(agg), f = buildFaceMakeup(fi), oilish = fi.type === 'oily' || fi.type === 'combo';
    const extra = f.tips.filter((t) => /코렉터|붉은|기름종이|파우더는 T존/.test(t));
    const tips = uniq(b.tips.slice(0, -1).concat(extra, [b.tips[b.tips.length - 1]])).slice(0, 8);
    return { primer: oilish ? f.primer : b.primer, finish: oilish ? f.finish : b.finish, finishWhy: oilish ? f.finishWhy : b.finishWhy, tips, focus: b.focus || f.focus };
  }
  root.HowRecommend = { buildCare, buildMakeup, buildFaceCare, buildFaceMakeup, faceFocus, buildZoneCare, buildZoneMakeup, skinTypeTU, SHINE_T, estimateTone, srgbToLab, SEASONS, NAMES };
})(typeof window !== 'undefined' ? window : globalThis);
