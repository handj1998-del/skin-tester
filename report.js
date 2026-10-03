/* H.O.W 전체 결과 리포트 — 기기 안에서 A4 페이지를 캔버스로 그리고(한글 정상 표시) JPEG를 담은 PDF를 직접 만듭니다.
   외부 라이브러리·폰트 없음. ES2017 (Chrome 72 이상). 필요할 때만 불러옵니다. */
(function (root) {
  'use strict';
  var W = 1240, H = 1754, M = 96, CW = W - M * 2, TOP = 150, BOTTOM = H - 110; // A4 @150dpi
  var F = 'Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", sans-serif';
  var SERIF = '"Cormorant Garamond", Georgia, "Times New Roman", serif';
  var INK = '#2b2523', SUB = '#6f6560', MUTE = '#8b807a', ACC = '#a9796d', LINE = 'rgba(43,37,35,.14)', SOFT = '#f6f2ee', CARD = '#fbf8f5';
  var TYPE_DESC = {
    oily: 'T존과 볼 모두 빛 반사(광택)가 많은 편이라 지성 경향으로 보여요. 유분 조절과 가벼운 보습의 균형이 중요해요.',
    combo: 'T존(이마·코)은 광택이 많고 볼은 상대적으로 적어 복합성 경향으로 보여요. 구역별로 케어를 나누면 좋아요.',
    drynormal: '얼굴 전체의 광택이 적은 편이라 건성·중성 경향으로 보여요. 수분 공급과 장벽 보호를 우선해 주세요.'
  };

  function font(x, w, s, f) { x.font = w + ' ' + s + 'px ' + (f || F); }
  function wrap(x, text, maxW) {
    var out = [], paras = String(text == null ? '' : text).split('\n');
    paras.forEach(function (p) {
      var words = p.split(' '), line = '';
      words.forEach(function (w) {
        var t = line ? line + ' ' + w : w;
        if (x.measureText(t).width <= maxW) { line = t; return; }
        if (line) out.push(line);
        if (x.measureText(w).width <= maxW) { line = w; return; }
        line = ''; // 긴 단어는 글자 단위로
        for (var i = 0; i < w.length; i++) { var t2 = line + w[i]; if (x.measureText(t2).width > maxW && line) { out.push(line); line = w[i]; } else line = t2; }
      });
      out.push(line);
    });
    return out;
  }
  function rr(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
  function spaced(x, text, X, y, sp, align) {
    var chars = Array.from(text), ws = chars.map(function (c) { return x.measureText(c).width; });
    var tot = ws.reduce(function (a, b) { return a + b; }, 0) + sp * (chars.length - 1);
    var px = align === 'center' ? X - tot / 2 : align === 'right' ? X - tot : X, al = x.textAlign; x.textAlign = 'left';
    chars.forEach(function (c, i) { x.fillText(c, px, y); px += ws[i] + sp; }); x.textAlign = al; return tot;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtFull(ts) { var d = new Date(ts); return d.getFullYear() + '. ' + pad2(d.getMonth() + 1) + '. ' + pad2(d.getDate()) + '  ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

  // ---------- 흐름 레이아웃 ----------
  function Doc(d) {
    this.d = d; this.pages = []; this.y = 0; this.newPage();
  }
  Doc.prototype.newPage = function () {
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H); x.textBaseline = 'alphabetic';
    this.pages.push(c); this.x = x; this.y = TOP;
    if (this.pages.length > 1) this.runningHeader();
  };
  Doc.prototype.ensure = function (h) { if (this.y + h > BOTTOM) { this.newPage(); return true; } return false; };
  Doc.prototype.runningHeader = function () {
    var x = this.x, d = this.d, L = d.logo;
    if (L && L.naturalWidth) { var lw = 104, lh = lw * L.naturalHeight / L.naturalWidth; x.drawImage(L, M, 62, lw, lh); }
    else { font(x, 600, 26); x.fillStyle = INK; x.fillText('H.O.W', M, 84); }
    font(x, 500, 19); x.fillStyle = MUTE; x.textAlign = 'right';
    x.fillText((d.name ? d.name + ' 님 · ' : '') + d.title + ' · ' + fmtFull(d.ts).split('  ')[0], W - M, 82); x.textAlign = 'left';
    x.fillStyle = LINE; x.fillRect(M, 104, CW, 1.5);
    this.y = TOP;
  };
  Doc.prototype.footers = function () {
    var n = this.pages.length, d = this.d;
    this.pages.forEach(function (c, i) {
      var x = c.getContext('2d');
      x.fillStyle = LINE; x.fillRect(M, H - 78, CW, 1.5);
      font(x, 400, 18); x.fillStyle = MUTE; x.textAlign = 'left';
      x.fillText('H.O.W 피부결 테스터 · v' + d.version + ' · 참고용 결과이며 의학적 진단이 아니에요', M, H - 46);
      x.textAlign = 'right'; font(x, 500, 20, SERIF); x.fillText((i + 1) + ' / ' + n, W - M, H - 46); x.textAlign = 'left';
    });
  };
  Doc.prototype.gap = function (h) { this.y += h; };
  Doc.prototype.section = function (kicker, title, keep) {
    this.ensure(110 + (keep || 160));
    var x = this.x, y = this.y + 34;
    font(x, 600, 17); x.fillStyle = ACC; spaced(x, kicker.toUpperCase(), M, y, 4);
    font(x, 600, 34); x.fillStyle = INK; x.fillText(title, M, y + 48);
    x.fillStyle = INK; x.fillRect(M, y + 70, 40, 2);
    this.y = y + 100;
  };
  Doc.prototype.sub = function (kicker, title) {
    this.ensure(70 + 90);
    var x = this.x, y = this.y + 28;
    font(x, 600, 26); x.fillStyle = INK; var tw = x.measureText(title).width; x.fillText(title, M, y);
    if (kicker) { font(x, 500, 16); x.fillStyle = ACC; spaced(x, kicker.toUpperCase(), M + tw + 14, y - 2, 3); }
    this.y = y + 22;
  };
  Doc.prototype.para = function (text, o) {
    o = o || {}; var x = this.x, size = o.size || 23, lh = o.lh || Math.round(size * 1.62), X = M + (o.indent || 0), maxW = (o.w || CW) - (o.indent || 0);
    font(x, o.weight || 400, size); var lines = wrap(x, text, maxW);
    var self = this;
    lines.forEach(function (ln) { if (self.ensure(lh)) font(self.x, o.weight || 400, size); var xx = self.x; xx.fillStyle = o.color || SUB; font(xx, o.weight || 400, size); xx.fillText(ln, X, self.y + size); self.y += lh; });
    this.y += o.after == null ? 6 : o.after;
  };
  Doc.prototype.list = function (items, ordered, o) {
    o = o || {}; var self = this, size = 23, lh = 37, X = M + (o.indent || 0), maxW = (o.w || CW) - (o.indent || 0) - 44;
    items.forEach(function (it, i) {
      font(self.x, 400, size); var lines = wrap(self.x, it, maxW);
      self.ensure(Math.min(lines.length, 2) * lh + 8);
      var x = self.x;
      if (ordered) { font(x, 500, 24, SERIF); x.fillStyle = ACC; x.fillText(pad2(i + 1), X, self.y + size); }
      else { x.fillStyle = ACC; x.beginPath(); x.arc(X + 8, self.y + size - 8, 4, 0, 7); x.fill(); }
      lines.forEach(function (ln, j) { if (j && self.ensure(lh)) {} var xx = self.x; font(xx, 400, size); xx.fillStyle = INK; xx.fillText(ln, X + 44, self.y + size); self.y += lh; });
      self.y += 8;
    });
    this.y += 6;
  };
  // 두 칼럼 목록 (아침/저녁)
  Doc.prototype.twoLists = function (a, b) {
    var x = this.x, colW = (CW - 40) / 2, size = 22, lh = 34, self = this;
    function lay(col) { font(x, 400, size); return col.items.map(function (it) { return wrap(x, it, colW - 66 - 26); }); }
    var la = lay(a), lb = lay(b);
    var hOf = function (L) { return 50 + L.reduce(function (s, l) { return s + l.length * lh + 10; }, 0); };
    var h = Math.max(hOf(la), hOf(lb)) + 24;
    this.ensure(h);
    x = this.x; var y0 = this.y;
    [[a, la, M], [b, lb, M + colW + 40]].forEach(function (q) {
      var col = q[0], L = q[1], X = q[2], y = y0;
      x.fillStyle = CARD; rr(x, X, y, colW, h - 10, 14); x.fill();
      font(x, 600, 16); x.fillStyle = ACC; var kw = spaced(x, col.kicker, X + 26, y + 40, 3);
      font(x, 600, 24); x.fillStyle = INK; x.fillText(col.title, X + 26 + kw + 12, y + 41);
      y += 68;
      L.forEach(function (lines, i) {
        font(x, 500, 22, SERIF); x.fillStyle = ACC; x.fillText(pad2(i + 1), X + 26, y + size - 2);
        font(x, 400, size); x.fillStyle = INK;
        lines.forEach(function (ln) { x.fillText(ln, X + 66, y + size - 2); y += lh; }); y += 10;
      });
    });
    this.y = y0 + h + 8;
  };
  Doc.prototype.defs = function (rows) {
    var self = this, nameW = 300;
    rows.forEach(function (r) {
      var x = self.x; font(x, 400, 22); var lines = wrap(x, r[1], CW - nameW - 20); font(x, 600, 23); var nl = wrap(x, r[0], nameW - 20);
      var h = Math.max(lines.length, nl.length) * 34 + 22;
      self.ensure(h); x = self.x;
      font(x, 600, 23); x.fillStyle = INK; nl.forEach(function (ln, i) { x.fillText(ln, M, self.y + 30 + i * 34); });
      font(x, 400, 22); x.fillStyle = SUB; lines.forEach(function (ln, i) { x.fillText(ln, M + nameW, self.y + 30 + i * 34); });
      self.y += h; x.fillStyle = LINE; x.fillRect(M, self.y - 6, CW, 1);
    });
    this.y += 10;
  };
  Doc.prototype.callout = function (title, lines, tone) {
    var x = this.x; font(x, 400, 22);
    var wrapped = []; lines.forEach(function (l) { wrapped = wrapped.concat(wrap(x, l, CW - 64)); });
    var h = 64 + wrapped.length * 34 + 18; this.ensure(h); x = this.x;
    x.fillStyle = tone === 'warn' ? '#f8efe9' : CARD; rr(x, M, this.y, CW, h, 14); x.fill();
    font(x, 600, 22); x.fillStyle = tone === 'warn' ? '#8f5446' : INK; x.fillText(title, M + 32, this.y + 44);
    font(x, 400, 22); x.fillStyle = SUB; var self = this;
    wrapped.forEach(function (ln, i) { x.fillText(ln, M + 32, self.y + 84 + i * 34); });
    this.y += h + 18;
  };
  Doc.prototype.bar = function (X, y, w, v, color, h) { var x = this.x; h = h || 8; x.fillStyle = 'rgba(43,37,35,.09)'; rr(x, X, y, w, h, h / 2); x.fill(); x.fillStyle = color; rr(x, X, y, Math.max(h, w * Math.min(1, Math.max(0, v))), h, h / 2); x.fill(); };
  Doc.prototype.imagesH = function (imgs, cols, aspect) {
    var iw = (CW - 24 * (cols - 1)) / cols, x = this.x; font(x, 400, 19);
    var capH = Math.max.apply(null, imgs.map(function (im) { return wrap(x, im.caption || '', iw).length; })) * 28;
    return iw * (aspect || 1) + 50 + capH + 20;
  };
  Doc.prototype.images = function (imgs, cols, aspect) {
    var gapX = 24, iw = (CW - gapX * (cols - 1)) / cols, ih = iw * (aspect || 1), x = this.x, self = this;
    font(x, 400, 19); var capLines = imgs.map(function (im) { return wrap(x, im.caption || '', iw); });
    var capH = Math.max.apply(null, capLines.map(function (l) { return l.length; })) * 28;
    var h = ih + 50 + capH + 20; this.ensure(h); x = this.x;
    imgs.forEach(function (im, i) {
      var X = M + i * (iw + gapX), y = self.y;
      x.save(); rr(x, X, y, iw, ih, 12); x.clip(); x.fillStyle = SOFT; x.fillRect(X, y, iw, ih);
      var c = im.canvas, s = Math.max(iw / c.width, ih / c.height), dw = c.width * s, dh = c.height * s;
      x.drawImage(c, X + (iw - dw) / 2, y + (ih - dh) / 2, dw, dh); x.restore();
      x.strokeStyle = LINE; x.lineWidth = 1.5; rr(x, X, y, iw, ih, 12); x.stroke();
      font(x, 600, 21); x.fillStyle = INK; x.fillText(im.title, X, y + ih + 34);
      font(x, 400, 19); x.fillStyle = SUB; capLines[i].forEach(function (ln, j) { x.fillText(ln, X, y + ih + 64 + j * 28); });
    });
    this.y += h;
  };
  Doc.prototype.swatches = function (label, arr, avoid) {
    var x = this.x, n = arr.length, cell = Math.min(170, (CW - 200) / Math.max(4, n)), h = 120;
    this.ensure(h); x = this.x; var y = this.y;
    font(x, 600, 22); x.fillStyle = INK; x.fillText(label, M, y + 50);
    arr.forEach(function (s, i) {
      var cx = M + 200 + i * cell + cell / 2;
      x.beginPath(); x.arc(cx, y + 42, 28, 0, 7); x.fillStyle = s[1]; x.fill(); x.strokeStyle = LINE; x.lineWidth = 1.5; x.stroke();
      if (avoid) { x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 3; x.beginPath(); x.moveTo(cx - 18, y + 60); x.lineTo(cx + 18, y + 24); x.stroke(); }
      font(x, 400, 18); x.fillStyle = SUB; x.textAlign = 'center';
      var ln = wrap(x, s[0], cell - 8).slice(0, 2); ln.forEach(function (l, j) { x.fillText(l, cx, y + 98 + j * 24); }); x.textAlign = 'left';
    });
    this.y += h + 12;
  };
  Doc.prototype.rule = function () { this.ensure(30); this.x.fillStyle = LINE; this.x.fillRect(M, this.y + 12, CW, 1.5); this.y += 30; };

  // ---------- 표지 (1페이지 상단) ----------
  function cover(doc) {
    var x = doc.x, d = doc.d, L = d.logo, y = 110;
    x.fillStyle = SOFT; x.fillRect(0, 0, W, 560);
    if (L && L.naturalWidth) { var lw = 230, lh = lw * L.naturalHeight / L.naturalWidth; x.drawImage(L, W / 2 - lw / 2, y, lw, lh); y += lh; }
    else { font(x, 600, 64); x.fillStyle = INK; x.textAlign = 'center'; x.fillText('H.O.W', W / 2, y + 60); x.textAlign = 'left'; y += 70; }
    font(x, 600, 17); x.fillStyle = ACC; x.textAlign = 'center'; spaced(x, d.mode === 'face' ? 'FACE SKIN REPORT' : 'SKIN TEXTURE REPORT', W / 2, y + 62, 6, 'center');
    font(x, 600, 46); x.fillStyle = INK; x.fillText(d.title, W / 2, y + 128);
    x.fillStyle = ACC; x.fillRect(W / 2 - 24, y + 156, 48, 2); x.textAlign = 'left';
    // 메타 정보
    var metas = [['이름', d.name || '—'], ['측정 일시', fmtFull(d.ts)], ['측정 방식', d.mode === 'face' ? '얼굴 전체 분석 (Beta)' : '가까이 촬영 · 피부결']];
    var my = 410, mw = CW / metas.length;
    x.fillStyle = '#ffffff'; rr(x, M, my, CW, 110, 16); x.fill(); x.strokeStyle = LINE; x.lineWidth = 1.5; x.stroke();
    metas.forEach(function (m, i) {
      var X = M + i * mw + 34;
      if (i) { x.fillStyle = LINE; x.fillRect(M + i * mw, my + 22, 1.5, 66); }
      font(x, 500, 18); x.fillStyle = MUTE; x.fillText(m[0], X, my + 42);
      font(x, 600, 25); x.fillStyle = INK; var t = m[1]; while (x.measureText(t).width > mw - 60 && t.length > 2) t = t.slice(0, -2) + '…'; x.fillText(t, X, my + 80);
    });
    doc.y = 610;
  }
  function closeupHero(doc) {
    var d = doc.d, x = doc.x, y = doc.y, cx = M + 150, cy = y + 150, R = 118;
    x.lineWidth = 12; x.strokeStyle = 'rgba(43,37,35,.08)'; x.beginPath(); x.arc(cx, cy, R, 0, 7); x.stroke();
    x.strokeStyle = INK; x.lineCap = 'round'; x.beginPath(); x.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * d.overall / 100); x.stroke(); x.lineCap = 'butt';
    x.textAlign = 'center'; font(x, 300, 110, SERIF); x.fillStyle = INK; x.fillText(String(d.overall), cx, cy + 30);
    font(x, 500, 19); x.fillStyle = SUB; x.fillText('피부결 점수', cx, cy + 70); x.textAlign = 'left';
    var X = M + 340, w = CW - 340;
    x.fillStyle = INK; rr(x, X, y + 48, 64, 64, 32); x.fill(); font(x, 500, 36, SERIF); x.fillStyle = '#fff'; x.textAlign = 'center'; x.fillText(d.grade.key, X + 32, y + 92); x.textAlign = 'left';
    font(x, 600, 38); x.fillStyle = INK; x.fillText(d.grade.label, X + 86, y + 94);
    font(x, 400, 23); x.fillStyle = SUB; wrap(x, d.grade.desc || '', w).slice(0, 4).forEach(function (ln, i) { x.fillText(ln, X, y + 156 + i * 36); });
    doc.y = y + 320;
  }
  function faceHero(doc) {
    var d = doc.d, x = doc.x, y = doc.y;
    font(x, 600, 17); x.fillStyle = ACC; spaced(x, 'SKIN TYPE', M, y + 30, 4);
    font(x, 600, 50); x.fillStyle = INK; x.fillText(d.type.name, M, y + 96);
    font(x, 500, 25); x.fillStyle = INK; var sl = wrap(x, d.summary, CW / 2 - 20); sl.forEach(function (ln, i) { x.fillText(ln, M, y + 150 + i * 38); });
    font(x, 400, 21); x.fillStyle = SUB; var dl = wrap(x, TYPE_DESC[d.type.key] || '', CW / 2 - 20); var y2 = y + 160 + sl.length * 38; dl.forEach(function (ln, i) { x.fillText(ln, M, y2 + i * 32); });
    var X = M + CW / 2 + 30, bw = CW / 2 - 30;
    d.tu.forEach(function (r, i) {
      var yy = y + 60 + i * 110;
      font(x, 600, 24); x.fillStyle = INK; x.fillText(r.label, X, yy);
      x.textAlign = 'right'; font(x, 600, 24); x.fillText(r.level, X + bw, yy); font(x, 400, 20); x.fillStyle = SUB; x.fillText('광택 ' + r.v + '%', X + bw - x.measureText(r.level).width - 70, yy); x.textAlign = 'left';
      doc.bar(X, yy + 22, bw, r.v / 10, r.color, 10);
    });
    font(x, 400, 19); x.fillStyle = MUTE; wrap(x, '광택 비율: 구역 안에서 빛 반사로 보이는 픽셀의 비율 (같은 사진 안 상대값)', bw).forEach(function (ln, i) { x.fillText(ln, X, y + 290 + i * 28); });
    doc.y = Math.max(y + 350, y2 + dl.length * 32 + 30);
  }

  // ---------- 본문 ----------
  function careSections(doc) {
    var d = doc.d, c = d.care, m = d.makeup;
    doc.section('Skin care', '맞춤 케어 루틴', 260);
    doc.callout('집중 영역 · ' + c.priorityName, [c.headline]);
    doc.twoLists({ kicker: 'AM', title: '아침', items: c.am }, { kicker: 'PM', title: '저녁', items: c.pm });
    doc.sub('Ingredients', '찾아볼 성분'); doc.defs(c.ingredients);
    doc.sub('Weekly', '주간 스페셜 케어'); doc.list(c.weekly);
    doc.sub('Avoid', '피하면 좋은 습관'); doc.list(c.avoid);
    doc.para('일반적인 화장품 사용 가이드예요. 자극·붉은기가 생기면 사용을 멈추고, 피부 질환이 의심되면 전문의와 상담하세요.', { size: 19, color: MUTE });
    doc.section('Makeup', '메이크업 가이드', 260);
    doc.callout('추천 베이스 마무리 · ' + m.finish, [m.finishWhy]);
    doc.sub('Primer', '프라이머'); doc.para(m.primer, { color: INK });
    doc.sub('How to', '바르는 방법'); doc.list(m.tips, true);
    doc.para('결과에 따른 일반적인 연출 팁이에요. 피부 타입과 사용 제품에 맞게 조절해 주세요.', { size: 19, color: MUTE });
  }
  function colorSection(doc) {
    var d = doc.d, t = d.tone, S = d.season, E = d.estSeason;
    doc.section('Personal color', '퍼스널컬러', 420);
    var x = doc.x, y = doc.y; doc.ensure(150); x = doc.x; y = doc.y;
    x.beginPath(); x.arc(M + 50, y + 56, 46, 0, 7); x.fillStyle = 'rgb(' + d.skinRGB.join(',') + ')'; x.fill(); x.strokeStyle = LINE; x.lineWidth = 1.5; x.stroke();
    font(x, 500, 18); x.fillStyle = MUTE; x.fillText(d.mode === 'face' ? '얼굴 피부색 기반 추정' : '사진 기반 추정', M + 130, y + 30);
    font(x, 600, 32); x.fillStyle = INK; x.fillText((t.undertone === 'warm' ? '웜' : '쿨') + ' 톤 · ' + E.name, M + 130, y + 74);
    font(x, 400, 20); x.fillStyle = SUB; x.fillText('신뢰도 ' + (t.confidence === 'low' ? '낮음' : '보통') + (t.neutral ? ' · 뉴트럴에 가까워요' : '') + ' · 조명과 화이트밸런스의 영향을 크게 받는 참고값', M + 130, y + 110);
    doc.y = y + 150;
    doc.callout((d.seasonChosen ? '선택한 컬러 · ' : '추천 팔레트 · ') + S.name + ' (' + S.en + ')', [S.desc]);
    doc.swatches('파운데이션', S.foundation); doc.swatches('립', S.lip); doc.swatches('블러셔', S.blush); doc.swatches('아이섀도', S.eye); doc.swatches('피할 컬러', S.avoid, true);
    doc.para('퍼스널컬러는 자연광에서 전문가 진단으로 확인하는 것이 가장 정확해요. 인쇄·화면 색상은 기기에 따라 다르게 보일 수 있어요.', { size: 19, color: MUTE });
  }
  function noticeSection(doc) {
    var d = doc.d;
    doc.section('Notice', '안내', 400);
    doc.callout('유의사항', [d.disclaimer]);
    doc.callout('개인정보', ['사진은 이 기기 안에서만 분석되며 서버로 전송·저장되지 않아요. 이 리포트도 기기 안에서 만들어졌고, 측정 결과와 이름은 이 기기에 저장되지 않아요.']);
  }

  function render(d) {
    var doc = new Doc(d);
    cover(doc);
    if (d.mode === 'face') {
      faceHero(doc);
      doc.section('Face map', '구역 지도', doc.imagesH(d.images, d.images.length, 1));
      doc.images(d.images, d.images.length, 1);
      doc.section('Zones', '구역별 상세', 420);
      zoneTable(doc);
      doc.para('붉은기는 같은 얼굴의 평균 대비 값(+는 더 붉음), 유분은 구역 안의 빛 반사(광택) 비율이에요. 결 점수는 얼굴 전체 사진의 해상도 한계로 참고용이며, 정확한 피부결은 기본 측정(가까이 촬영)을 이용해 주세요.', { size: 19, color: MUTE });
    } else {
      closeupHero(doc);
      doc.section('Detail', '항목별 점수', 380);
      doc.para('점수 기준 · 85 이상 아주 좋음 · 70 이상 좋음 · 55 이상 보통 · 40 이상 관리 필요 · 40 미만 집중 관리', { size: 19, color: MUTE, after: 14 });
      metrics(doc);
      doc.section('Map', '분석 이미지', doc.imagesH(d.images, d.images.length, 1));
      doc.images(d.images, d.images.length, 1);
    }
    doc.section('Photo check', '촬영 참고', 140);
    if (d.warnings.length) doc.callout('결과에 영향을 줄 수 있는 촬영 조건', d.warnings, 'warn');
    else doc.para('촬영 조건에서 특이사항이 발견되지 않았어요. 그래도 조명·거리·카메라에 따라 결과가 달라질 수 있어요.', { color: SUB });
    careSections(doc);
    colorSection(doc);
    noticeSection(doc);
    doc.footers();
    return doc.pages;
  }
  function metrics(doc) {
    doc.d.metrics.forEach(function (m) {
      doc.ensure(150); var x = doc.x, y = doc.y;
      font(x, 600, 28); x.fillStyle = INK; x.fillText(m.name, M, y + 34); var nw = x.measureText(m.name).width;
      font(x, 400, 26, SERIF); x.fillStyle = SUB; x.fillText(m.en, M + nw + 14, y + 34);
      x.textAlign = 'right'; font(x, 400, 50, SERIF); x.fillStyle = INK; x.fillText(String(m.score), W - M, y + 40);
      var sw = x.measureText(String(m.score)).width; font(x, 600, 22); x.fillStyle = m.color; x.fillText(m.label, W - M - sw - 20, y + 36); x.textAlign = 'left';
      doc.bar(M, y + 60, CW, m.score / 100, m.color, 10);
      font(x, 400, 21); x.fillStyle = SUB; var lines = wrap(x, m.desc + (m.note ? ' ' + m.note : ''), CW);
      lines.forEach(function (ln, i) { x.fillText(ln, M, y + 104 + i * 32); });
      doc.y = y + 104 + lines.length * 32 + 16;
    });
  }
  function zoneTable(doc) {
    var cols = [M, M + 250, M + 570, M + 890], d = doc.d;
    function head() { var x = doc.x, y = doc.y; font(x, 600, 18); x.fillStyle = MUTE; ['구역', '붉은기 (얼굴 평균 대비)', '유분 (광택 비율)', '결 (참고)'].forEach(function (t, i) { x.fillText(t, cols[i], y + 24); }); x.fillStyle = INK; x.fillRect(M, y + 40, CW, 1.5); doc.y = y + 48; }
    doc.ensure(130); head();
    d.zones.forEach(function (z) {
      if (doc.ensure(72)) head();
      var x = doc.x, y = doc.y;
      x.fillStyle = 'rgba(43,37,35,.78)'; x.beginPath(); x.arc(cols[0] + 16, y + 34, 16, 0, 7); x.fill();
      font(x, 600, 17); x.fillStyle = '#fff'; x.textAlign = 'center'; x.fillText(String(z.n), cols[0] + 16, y + 40); x.textAlign = 'left';
      font(x, 600, 23); x.fillStyle = INK; x.fillText(z.name, cols[0] + 46, y + 42);
      if (z.missing) { font(x, 400, 20); x.fillStyle = MUTE; x.fillText('가려져서 측정하지 못했어요', cols[1], y + 42); }
      else {
        font(x, 600, 21); x.fillStyle = INK; x.fillText(z.red.level, cols[1], y + 30); font(x, 400, 19); x.fillStyle = SUB; x.fillText(z.red.text, cols[1] + 70, y + 30);
        doc.bar(cols[1], y + 44, 270, z.red.bar / 100, z.red.color, 8);
        font(x, 600, 21); x.fillStyle = INK; x.fillText(z.shine.level, cols[2], y + 30); font(x, 400, 19); x.fillStyle = SUB; x.fillText(z.shine.text, cols[2] + 70, y + 30);
        doc.bar(cols[2], y + 44, 270, Math.max(3, z.shine.bar) / 100, z.shine.color, 8);
        font(x, 400, 30, SERIF); x.fillStyle = INK; x.fillText(z.texture == null ? '—' : String(z.texture), cols[3], y + 44);
      }
      x.fillStyle = LINE; x.fillRect(M, y + 70, CW, 1); doc.y = y + 72;
    });
    doc.y += 14;
  }

  // ---------- 출력: PDF (JPEG 페이지) ----------
  function jpegBytes(c, q) {
    var b64 = c.toDataURL('image/jpeg', q || 0.9).split(',')[1], bin = atob(b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    if (u[0] !== 0xff || u[1] !== 0xd8) throw new Error('jpeg not supported');
    return u;
  }
  function toPDF(pages, meta) {
    var parts = [], offs = [], len = 0, enc = function (s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
    function put(x) { var u = typeof x === 'string' ? enc(x) : x; parts.push(u); len += u.length; }
    function obj(n, body) { offs[n] = len; put(n + ' 0 obj\n'); body(); put('\nendobj\n'); }
    var pw = 595.28, ph = 841.89, n = pages.length, kids = [];
    for (var i = 0; i < n; i++) kids.push((4 + i * 3) + ' 0 R');
    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    obj(1, function () { put('<< /Type /Catalog /Pages 2 0 R >>'); });
    obj(2, function () { put('<< /Type /Pages /Count ' + n + ' /Kids [' + kids.join(' ') + '] >>'); });
    obj(3, function () { put('<< /Title (' + (meta && meta.title || 'H.O.W Report').replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '') + ') /Producer (H.O.W Skin Tester) /Creator (H.O.W Skin Tester) >>'); });
    pages.forEach(function (c, i) {
      var pn = 4 + i * 3, cn = pn + 1, im = pn + 2, jpg = jpegBytes(c, 0.9), cs = 'q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im0 Do Q';
      obj(pn, function () { put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + cn + ' 0 R >>'); });
      obj(cn, function () { put('<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream'); });
      obj(im, function () { put('<< /Type /XObject /Subtype /Image /Width ' + c.width + ' /Height ' + c.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n'); put(jpg); put('\nendstream'); });
    });
    var total = 4 + n * 3, xref = len, s = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (var k = 1; k < total; k++) s += ('0000000000' + offs[k]).slice(-10) + ' 00000 n \n';
    put(s + 'trailer\n<< /Size ' + total + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(parts, { type: 'application/pdf' });
  }
  // 긴 이미지 (모든 페이지를 세로로 이어 붙임, 구형 기기 메모리 고려해 축소)
  function toLongImage(pages, scale) {
    scale = scale || 0.75; var w = Math.round(W * scale), h = Math.round(H * scale), gap = Math.round(16 * scale);
    var c = document.createElement('canvas'); c.width = w; c.height = h * pages.length + gap * (pages.length - 1);
    var x = c.getContext('2d'); x.fillStyle = '#e9e3de'; x.fillRect(0, 0, c.width, c.height);
    pages.forEach(function (p, i) { x.drawImage(p, 0, i * (h + gap), w, h); });
    return c;
  }
  root.HowReport = { render: render, toPDF: toPDF, toLongImage: toLongImage, PAGE: { W: W, H: H } };
})(typeof window !== 'undefined' ? window : this);
