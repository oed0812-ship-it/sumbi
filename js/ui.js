/* ============================================================
   숨비 (SUMBI) — ui.js
   불턱 / 도감 / 설정 / 정산 오버레이 + HUD + 부팅

   ★ 별도 진행도 UI 를 만들지 마세요. 불턱 배경이 진행도입니다.
   ★ 살림은 상점 목록이 아니라 배경 위의 클릭 핫스팟입니다.
   ============================================================ */
var SUMBI = SUMBI || {};

var UI = (function () {

  function $(id) { return document.getElementById(id); }
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }

  /* [r,g,b] ↔ "#rrggbb" — 디버그 패널 색상 스와치용 */
  function hexOf(c) {
    function h(v) { return ('0' + clamp(Math.round(v), 0, 255).toString(16)).slice(-2); }
    return '#' + h(c[0]) + h(c[1]) + h(c[2]);
  }
  function setFromHex(arr, hex) {
    var n = parseInt(hex.slice(1), 16);
    arr[0] = (n >> 16) & 255; arr[1] = (n >> 8) & 255; arr[2] = n & 255;
  }

  var stage, wrap;
  var seq = [];            /* 연출 큐 (승급 → 살림 공개 → …) */

  /* ── 젖은 버튼 ── */
  function wet(el) {
    el.classList.remove('wet');
    void el.offsetWidth;
    el.classList.add('wet');
    setTimeout(function () { el.classList.remove('wet'); }, 30);
  }
  function bind(el, fn) {
    if (!el) return;
    el.addEventListener('click', function (e) {
      wet(el); AUDIO.sfx('ui'); fn(e);
    });
  }


  /* ============================================================
     무대 스케일
     ============================================================ */
  function resizeStage() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var s = Math.min(vw / CONFIG.VIEW_W, vh / CONFIG.VIEW_H);
    stage.style.transform = 'scale(' + s + ')';
    document.body.classList.toggle('portrait', vh > vw && vw < 720);
  }


  /* ============================================================
     토스트
     ★ anchor 를 주면 그 논리좌표 위에 말풍선처럼 뜬다 (동료 해녀 머리 위 등).
       생략하면 기존처럼 화면 하단 중앙. 모달이 아니라 여전히 토스트이므로
       입력을 막지 않는다.
     ============================================================ */
  var toastT = null;
  function toast(msg, anchor) {
    var el = $('toast');
    el.textContent = msg;
    if (anchor) {
      el.style.left = anchor.x + 'px';
      el.style.top = anchor.y + 'px';
      el.classList.add('anchored');
    } else {
      el.style.left = ''; el.style.top = '';
      el.classList.remove('anchored');
    }
    el.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.classList.remove('on'); }, 1900);
  }


  /* ============================================================
     화면 전환
     ============================================================ */
  function showScreen(id) {
    var list = ['scr-title','scr-bulteok','scr-journal'];
    for (var i = 0; i < list.length; i++) $(list[i]).classList.toggle('on', list[i] === id);
  }

  function onStateChange(s) {
    $('hud').classList.toggle('on', s === 'dive');
    if (s === 'title')   { showScreen('scr-title'); refreshTitle(); }
    if (s === 'bulteok') { showScreen('scr-bulteok'); applyHomeHints(); refreshBulteok(); }
    if (s === 'dive')    { showScreen(''); buildDepthRuler(); }
    if (s === 'journal') { showScreen('scr-journal'); openJournal(); }
  }

  /* ── 수심 눈금자 — 바당마다 최대 수심이 달라서 진입할 때 한 번만 다시 그린다.
     0m(위) ~ 이 바당의 최대 수심(아래) 사이를 4등분해 눈금선 5개를 찍는다.
     ★ 눈금마다 붙던 수심 라벨(0m/6m/12m…)은 없앴다 — 실제로 읽는 숫자는
       '지금 내 수심' 하나뿐이라, 나머지는 시야만 어지럽혔다. 그 숫자는
       마커(#drDepthTxt)가 들고 다니며 매 프레임 tick() 이 갱신한다. */
  function buildDepthRuler() {
    var el = $('drTicks');
    var html = '';
    for (var i = 0; i <= 4; i++) {
      html += '<div class="drTick" style="top:' + ((i / 4) * 100) + '%"></div>';
    }
    el.innerHTML = html;
  }

  /* ── 화면 전환 페이드 ──
     어두워진 다음(화면이 완전히 가려진 시점) applyFn 으로 실제 전환을 수행하고,
     그 직후 다시 밝아진다. 전환 자체(어떤 화면으로 가는지)는 applyFn 몫이라
     타이틀→불턱, 불턱→다이빙 등 어디에서나 그대로 재사용한다. */
  var FADE_HOLD = 560, FADE_DUR = 600;
  function fadeTo(applyFn) {
    var fade = $('fade');
    fade.style.pointerEvents = 'auto';
    fade.classList.add('on');
    setTimeout(function () {
      applyFn();
      /* ★ rAF 대신 setTimeout — 탭이 백그라운드로 밀려 rAF 가 억제되어도
         전환이 그대로 진행되어야 한다(예: 잠깐 다른 창을 봤다 돌아온 경우). */
      setTimeout(function () {
        fade.classList.remove('on');
        setTimeout(function () { fade.style.pointerEvents = ''; }, FADE_DUR);
      }, 20);
    }, FADE_HOLD);
  }

  /* 조건이 찬 살림 자리를 hidden→hinted 로 넘기고, 새로 넘어간 자리마다
     동료의 "한 번 바라봄"을 트리거한다. ★ 팝업도 대사도 없다 — 시선뿐. */
  function applyHomeHints() {
    var hinted = checkHomeHints();
    for (var i = 0; i < hinted.length; i++) {
      var h = HOME_BY_ID[hinted[i]];
      RENDER.triggerAllyGlance(h.hx + h.hw / 2, h.hy + h.hh / 2);
    }
  }

  function overlay(id, on) {
    $(id).classList.toggle('on', !!on);
    GAME.pause(anyOverlay());
  }
  function anyOverlay() {
    var ids = ['ovSettle','ovRank','ovLine','dexPop','ovSet'];
    for (var i = 0; i < ids.length; i++) if ($(ids[i]).classList.contains('on')) return true;
    return $('howto').classList.contains('on');
  }


  /* ============================================================
     타이틀
     ============================================================ */
  function refreshTitle() {
    var has = SAVE.exists();
    $('btnContinue').disabled = !has;
    $('btnStart').textContent = has ? '새로 시작' : '시작';
  }

  function beginAudio() {
    AUDIO.init();               /* ★ 반드시 사용자 제스처 안에서 */
    AUDIO.applySettings();
  }

  function startNew() {
    beginAudio();
    SAVE.reset();
    afterTitle();
  }

  function continueGame() {
    beginAudio();
    SAVE.load();
    afterTitle();
  }

  function afterTitle() {
    if (!PROGRESS.seenHowto) {
      overlay('howto', true);
      $('howto').classList.add('on');
      GAME.pause(true);
    } else {
      fadeTo(function () { GAME.goto('bulteok'); });
    }
  }


  /* ============================================================
     불턱
     ============================================================ */
  function refreshBulteok() {
    $('bkDay').textContent = '물질 ' + PROGRESS.day + '일째';
    $('bkMoney').textContent = wonText(PROGRESS.money);

    buildGear();
    buildBadang();
    buildHotspots();
  }

  /* ── 장비 3행 — 종류당 행 1개, 행마다 "업그레이드(₩금액)" 버튼 1개.
     최대 레벨(3)이면 버튼 자리가 비활성 표시("최대 레벨")로 바뀐다(기존과
     동일한 정책 — 그 이상은 살 수 없다). ── */
  function buildGear() {
    var el = $('gearGrid');
    el.innerHTML = '';
    for (var i = 0; i < GEAR.length; i++) {
      var g = GEAR[i];
      var cur = PROGRESS.gear[g.id];        /* 1~3 */
      var maxed = cur >= 3;
      var nextLv = cur + 1;
      var price = maxed ? 0 : g.price[nextLv - 1];
      var afford = maxed || PROGRESS.money >= price;

      var d = document.createElement('div');
      d.className = 'grow';
      d.innerHTML =
        '<div class="gname">' + g.name + '<span class="lv">Lv' + cur + '</span></div>' +
        '<div class="gstat">' + g.effect[cur - 1] +
          (maxed ? '' : '<span class="efNext">→ ' + g.effect[nextLv - 1] + '</span>') +
        '</div>' +
        (maxed
          ? '<div class="g-max">최대 레벨</div>'
          : '<button class="g-action' + (afford ? '' : ' poor') + '"><span class="cap">업그레이드</span><span class="val">' + wonText(price) + '</span></button>');
      if (!maxed) {
        (function (id, level, cell) {
          cell.querySelector('.g-action').addEventListener('click', function () { tryBuyGear(id, level, cell); });
        })(g.id, nextLv, d);
      }
      el.appendChild(d);
    }
    /* 다음 승급까지 필요한 것 — 별도 진행도 UI 가 아니라 장비 패널의 한 줄 */
    var sf = rankShortfall();
    $('gearNote').innerHTML = sf
      ? '<b style="color:#e5b25d">' + sf.rank.name + '</b> 승급까지 — ' + (sf.miss.length ? sf.miss.join(' · ') : '조건 충족')
      : '더 오를 데가 없다.';
  }

  function tryBuyGear(id, lv, cell) {
    if (!canBuyGear(id, lv)) { toast(LINES.cantAfford); return; }
    buyGear(id, lv);
    wet(cell);
    AUDIO.sfx('upgrade');
    /* ★ 첫 장비 구매 직후 솥 자리가 hinted 로 넘어간다.
       팝업 없이 반짝임 + 동료의 시선만 — 발견은 플레이어의 클릭에서 시작된다. */
    applyHomeHints();
    refreshBulteok();
    seq = [];
    queuePromotion();
    runSeq();
  }

  /* ── 불턱 → 다이빙 ──
     어두워졌다가 다이빙 화면이 나타나면서 동시에 카메라가 평소보다 더 깊은
     지점에서 시작해 정착 위치까지 스스로 떠오른다 — "물에서 떠오르는" 느낌.
     startDive() 가 매 프레임 updateCamera() 로 자연스럽게 수렴시키므로
     여기서는 시작 cam.cy 에 한 번 깊게 오프셋만 주면 된다.

     ★ 암전이 완전히 덮인 동안 화면 한가운데에 바당별 문구를 페이드 인 →
       1.0초 노출 → 페이드 아웃으로 짧게 보여준다. 문구 텍스트는
       BADANG[].diveLine 하나만 바꾸면 언제든 교체된다(코드 수정 불필요).
       일반 fadeTo() 와 달리 암전을 문구가 다 사라질 때까지 붙잡아야 하므로
       이 함수만 별도 타이밍으로 돈다. */
  var DIVE_LINE_FADE = 280, DIVE_LINE_HOLD = 1000;
  function enterDive(badangId) {
    var fade = $('fade'), line = $('diveLine');
    var b = BADANG_BY_ID[badangId];
    fade.style.pointerEvents = 'auto';
    fade.classList.add('on');
    line.textContent = (b && b.diveLine) || '';
    setTimeout(function () {
      GAME.startDive(badangId);
      GAME.G.cam.cy += CONFIG.DIVE_INTRO_RISE;
      line.classList.add('on');
      setTimeout(function () {
        line.classList.remove('on');
        setTimeout(function () {
          fade.classList.remove('on');
          setTimeout(function () { fade.style.pointerEvents = ''; }, FADE_DUR);
        }, DIVE_LINE_FADE);
      }, DIVE_LINE_FADE + DIVE_LINE_HOLD);
    }, FADE_HOLD);
  }

  /* ── 바당 카드 캐러셀 — 잠긴 것도 조건과 함께 보인다.
     badangIdx = 지금 가운데(선택)에 있는 바당의 인덱스. 세션 중에만
     유지되고(저장 안 함), 화살표 클릭·스와이프로 -1~+1 씩 움직인다.
     3개뿐이라 끝에서는(0 또는 마지막) 한쪽 화살표를 비활성화한다
     (원형으로 돌지 않는다 — 난이도 순서라 자연스러운 진행이 아니다). ── */
  var badangIdx = 0;

  function buildBadang() {
    var stage = $('badangStage');
    stage.innerHTML = '';
    for (var i = 0; i < BADANG.length; i++) {
      var b = BADANG[i];
      var open = badangUnlocked(b);
      var offset = i - badangIdx;              /* -1(왼쪽) / 0(가운데) / +1(오른쪽) */
      if (Math.abs(offset) > 1) continue;      /* 끝 카드에서는 반대편 카드를 아예 안 그린다 */

      /* ★ 가운데(active) 카드 안에 '선택' 버튼이 들어가므로, 버튼을 품을 수
         있도록 카드 자체는 <button>이 아니라 <div>다 — 옆 카드는 여전히
         카드 전체 클릭으로 가운데로 넘어온다(아래 이벤트 참고). */
      var c = document.createElement('div');
      c.className = 'bcard' + (open ? '' : ' locked') + (offset === 0 ? ' active' : ' side');
      c.style.zIndex = offset === 0 ? 3 : 1;
      c.style.transform = 'translate(calc(-50% + ' + (offset * 104) + 'px), -50%) scale(' + (offset === 0 ? 1 : 0.8) + ')';
      /* ★ 수심은 카드 제목 옆에 따로 보여준다 — desc 앞머리의 "20m · "는
         그래서 중복이라 떼어낸다(데이터는 그대로 두고 표시할 때만). */
      var descBody = b.desc.replace(/^\s*\d+m\s*·\s*/, '');
      c.innerHTML =
        (open ? '' : '<span class="lk"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#e5b25d" stroke-width="1.4"><rect x="2.5" y="6" width="9" height="6.5" rx="1.4"/><path d="M4.6 6V4.2a2.4 2.4 0 0 1 4.8 0V6"/></svg></span>') +
        '<div class="bn">' + b.name + '<span class="bdep">' + b.depthM + 'm</span></div>' +
        '<div class="bcRule"></div>' +
        '<div class="bd">' + descBody + '</div>' +
        '<div class="bt">' + (open ? b.tag : b.lockText) + '</div>' +
        (offset === 0 ? '<button class="bcSelect' + (open ? '' : ' locked') + '">선택</button>' : '');
      (function (bb, isOpen, off, card) {
        if (off !== 0) {
          /* 옆 카드 — 클릭하면 가운데로 넘어온다 */
          card.addEventListener('click', function () { badangIdx += off; buildBadang(); });
        } else {
          /* 가운데 카드 — 다이빙 입수는 '선택' 버튼으로만 */
          var sel = card.querySelector('.bcSelect');
          sel.addEventListener('click', function () {
            AUDIO.sfx('ui');
            if (!isOpen) { toast(LINES.locked); return; }
            enterDive(bb.id);
          });
        }
      })(b, open, offset, c);
      stage.appendChild(c);
    }
    $('bcPrev').disabled = badangIdx <= 0;
    $('bcNext').disabled = badangIdx >= BADANG.length - 1;
  }

  /* 화살표 + 스와이프(포인터 드래그) — boot() 에서 한 번만 배선한다 */
  function bindBadangCarousel() {
    bind($('bcPrev'), function () { if (badangIdx > 0) { badangIdx--; buildBadang(); } });
    bind($('bcNext'), function () { if (badangIdx < BADANG.length - 1) { badangIdx++; buildBadang(); } });

    var stage = $('badangStage');
    var dragX = null;
    stage.addEventListener('pointerdown', function (e) { dragX = e.clientX; });
    window.addEventListener('pointerup', function (e) {
      if (dragX === null) return;
      var dx = e.clientX - dragX;
      dragX = null;
      if (Math.abs(dx) < 30) return;           /* 스와이프로 인정할 최소 거리 */
      if (dx < 0 && badangIdx < BADANG.length - 1) { badangIdx++; buildBadang(); }
      else if (dx > 0 && badangIdx > 0) { badangIdx--; buildBadang(); }
    });
  }

  /* ── 살림 핫스팟 ──────────────────────────────────────────
     ★ 시각 표시는 CSS ::after(젖은 광택)뿐 — hidden 이면 아예 안 보인다.
       hinted/known 은 은은하게, 소지금이 충분해지면(hinted/known 무관)
       더 뚜렷해진다. 라벨 텍스트는 없다: 이름·값은 카드를 열어야 보인다. */
  /* ★ 핫스팟은 집 1개 + 밭 1개, 총 2개뿐이다.
     집 핫스팟은 그 시점에 "아직 안 산 첫 항목"(pot → books 순차)을 담당한다.
     담당할 항목이 없으면(둘 다 샀거나 아직 hidden) 광택도 클릭도 없다. */
  function activeHomeForSpot(spot) {
    for (var i = 0; i < HOME_ORDER.length; i++) {
      var h = HOME_BY_ID[HOME_ORDER[i]];
      if (h.spot !== spot) continue;
      if (PROGRESS.home[h.id]) continue;                 /* 이미 산 것은 건너뛴다 */
      if (PROGRESS.homeState[h.id] === 'hidden') continue;
      return h;
    }
    return null;
  }

  function buildHotspots() {
    for (var s = 0; s < HOME_SPOTS.length; s++) {
      var spot = HOME_SPOTS[s];
      var el = $('hs-' + spot);
      if (!el) continue;
      var h = activeHomeForSpot(spot);
      /* 사각형은 그 자리의 대표 항목 좌표를 쓴다 — 같은 spot 은 좌표가 같다 */
      var rect = h || HOME_BY_ID[spot === 'house' ? 'pot' : 'field'];
      el.style.left = rect.hx + 'px'; el.style.top = rect.hy + 'px';
      el.style.width = rect.hw + 'px'; el.style.height = rect.hh + 'px';
      el.dataset.home = h ? h.id : '';
      var st = h ? PROGRESS.homeState[h.id] : 'hidden';
      el.classList.toggle('on', !!h);
      el.classList.toggle('known', !!h && st === 'known');
      el.classList.toggle('afford', !!h && PROGRESS.money >= h.price);
      el.classList.toggle('bought', !h);
    }
    refreshHomeCard();
  }

  /* hinted 자리를 클릭 → known 으로 열고, 동료 말풍선(토스트, 모달 아님)을 띄운다.
     이미 known 이면 그냥 카드를 다시 보여주는 것으로 충분하다(재갱신). */
  function onHomeHotspotClick(spot) {
    var h = activeHomeForSpot(spot);
    if (!h) return;
    if (PROGRESS.homeState[h.id] === 'hinted') {
      openHomeCard(h.id);
      toast(LINES[h.revealLine], RENDER.allyHeadPos());
    }
    refreshBulteok();
  }

  /* ── 살림 구매 카드 — 모달 아님. known && !bought 인 자리 하나에만 뜬다.
     동시에 known 인 자리는 순차 공개 구조상 최대 1개뿐이다. ── */
  function refreshHomeCard() {
    var openId = null;
    for (var i = 0; i < HOME_ORDER.length; i++) {
      var id = HOME_ORDER[i];
      if (PROGRESS.homeState[id] === 'known' && !PROGRESS.home[id]) { openId = id; break; }
    }
    var card = $('homeCard');
    if (!openId) { card.classList.remove('on'); card.dataset.id = ''; return; }
    var h = HOME_BY_ID[openId];
    var afford = PROGRESS.money >= h.price;
    $('homeCardName').textContent = h.name;
    /* 가격은 별도 줄이 아니라 구매 버튼 안에 — 장비 '업그레이드' 버튼과 같은 형식 */
    $('homeCardBuy').innerHTML = '<span class="cap">구매</span><span class="val">' + wonText(h.price) + '</span>';
    $('homeCardShort').style.display = afford ? 'none' : 'block';
    $('homeCardShort').textContent = afford ? '' : (numText(h.price - PROGRESS.money) + ' 부족');
    $('homeCardBuy').disabled = !afford;
    card.style.left = (h.hx + h.hw / 2) + 'px';
    card.style.top = (h.hy - 10) + 'px';
    card.dataset.id = openId;
    card.classList.add('on');
  }

  function buyHomeFromCard() {
    var id = $('homeCard').dataset.id;
    if (!id || !canBuyHome(id)) return;
    buyHome(id);
    wet($('homeCardBuy'));
    AUDIO.sfx('upgrade');
    var h = HOME_BY_ID[id];
    toast(LINES[h.boughtLine], RENDER.allyHeadPos());

    /* ★ 밭을 사면 엔딩. 그리고 게임은 계속됩니다. "다 깼습니다" 화면은 없습니다.
       이건 살림 발견 흐름과 무관한 일회성 연출이라 기존 모달 시퀀스를 그대로 쓴다. */
    seq = [];
    if (id === 'field' && !PROGRESS.endingSeen) {
      PROGRESS.endingSeen = true;
      SAVE.save();
      seq.push({ type:'ending' });
    }
    applyHomeHints();
    refreshBulteok();
    queuePromotion();
    if (seq.length) { GAME.pause(true); runSeq(); }
  }


  /* ============================================================
     연출 큐
     ============================================================ */
  function queuePromotion() {
    var r = checkPromotion();
    if (r) seq.push({ type:'rank', rank: r });
  }

  function runSeq() {
    if (seq.length === 0) { refreshBulteok(); GAME.pause(false); return; }
    var s = seq.shift();
    if (s.type === 'rank') showRank(s.rank);
    else if (s.type === 'line') showLine(s.who, s.text);
    else if (s.type === 'ending') { showEnding(); runSeq(); }
    else runSeq();
  }

  /* 승급 연출 — 3~4초 이내, 스킵 가능 */
  function showRank(r) {
    var prev = RANKS[RANK_INDEX[r.id] - 1];
    $('rankFrom').textContent = prev ? prev.name : '';
    $('rankTo').textContent = r.name;
    var dots = '';
    for (var i = 0; i < 3; i++) dots += '<i class="' + (i < r.dot ? 'on' : '') + '"></i>';
    $('rankDots').innerHTML = dots;
    $('rankLine').textContent = LINES[r.line] || '';
    var b = BADANG[r.unlock];
    var un = b ? b.name + ' 해금' : '';
    if (r.grantLantern) un += (un ? ' · ' : '') + '랜턴 지급 — ' + LINES.lanternGift;
    $('rankUnlock').textContent = un;
    /* ★ 승급으로 새 바다가 열리면 캐러셀 기본 선택도 그 바다로 옮긴다 */
    if (b) badangIdx = r.unlock;
    overlay('ovRank', true);
    AUDIO.sfx('rank');
    refreshBulteok();
  }

  /* ★ 살림 발견/구매 대사는 더 이상 여기를 거치지 않는다 (toast 로 이동).
     이 모달은 승급·엔딩처럼 진짜 "장면"이 필요한 순간에만 남는다. */
  function showLine(who, text) {
    $('lineWho').textContent = who || '';
    $('lineWho').style.display = who ? '' : 'none';
    $('lineTxt').textContent = text;
    overlay('ovLine', true);
  }

  /* ★ 밭 획득 직후 한 줄 — 예전엔 블랙 페이드 + 모달이었지만, "밭에서 뭔가 해야
     할 것 같다"는 착각을 줘서 토스트로 낮췄다. 문구는 추후 별도로 교체 예정. */
  function showEnding() {
    toast(LINES.ending, RENDER.allyHeadPos());
  }


  /* ============================================================
     정산 오버레이
     ============================================================ */
  var settleData = null;

  function showSettle(data) {
    settleData = data;
    $('settleTitle').textContent = PROGRESS.day + '일째 물질';
    var list = $('settleList');
    list.innerHTML = '';
    for (var i = 0; i < data.rows.length; i++) {
      var r = data.rows[i];
      var sp = SPECIES_BY_ID[r.id];
      var d = document.createElement('div');
      d.className = 'srow' + (r.bonus ? ' bonus' : '');
      d.innerHTML = '<span>' + sp.name + '<span class="qty">× ' + r.n + '</span>' +
                    (r.bonus ? '<span class="qty" style="color:#e5b25d">물숨</span>' : '') + '</span>' +
                    '<span class="val">' + numText(r.sum) + '</span>';
      list.appendChild(d);
    }
    $('settleEmpty').style.display = data.rows.length ? 'none' : '';
    $('settleTotal').textContent = numText(data.total);
    $('settleDepth').textContent = data.depth.toFixed(1) + 'm';
    $('btnSell').textContent = data.total > 0 ? '판 매' : '불턱으로';

    /* ★ 해녀 일지 — 이 물때의 항목을 지금 만들어 저장하고, 같은 카드 안에서
       바로 보여준다(추가 클릭 0회). 문장이 없는 날은 블록 자체를 비워
       CSS(:empty)가 여백까지 없앤다. */
    var entry = buildJournalEntry({
      total: data.total, depth: data.depth, reason: data.reason,
      mulsum: !!data.mulsum, newDex: data.newDex || [], deepest: !!data.deepest,
      firstBadang: data.firstBadang || ''
    });
    $('settleJournal').innerHTML = journalLinesHTML(entry.lines);

    overlay('ovSettle', true);
  }

  /* 일지 문장 묶음 → HTML. 서사(story)는 앞에 얇은 세로선이 붙는다(CSS) */
  function journalLinesHTML(lines) {
    if (!lines || !lines.length) return '';
    var html = '';
    for (var i = 0; i < lines.length; i++) {
      html += '<div class="jline ' + lines[i].t + '">' + escapeHTML(lines[i].s) + '</div>';
    }
    return html;
  }
  function escapeHTML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ============================================================
     해녀 일지 / 도감 — 펼친 수첩 하나
     ★ '도감' 버튼이 따로 없다. 일지 화면 옆에 붙은 색인 스티커 탭이
       같은 수첩 위의 내용만 바꿔치기한다(일지 ↔ 도감), 탭 글자도 같이 토글된다.
     ============================================================ */
  var jrMode = 'journal';   /* 'journal' | 'dex' */
  var jrIdx = 0;            /* PROGRESS.journal 안의 현재 페이지(날짜) 인덱스 */

  function openJournal() {
    jrMode = 'journal';
    jrIdx = PROGRESS.journal.length ? PROGRESS.journal.length - 1 : 0;
    renderNotebook();
  }

  function toggleJournalMode() {
    jrMode = (jrMode === 'dex') ? 'journal' : 'dex';
    renderNotebook();
  }

  function renderNotebook() {
    var isDex = jrMode === 'dex';
    $('dexView').classList.toggle('on', isDex);
    $('nbTab').textContent = isDex ? '일지' : '도감';
    $('btnJrPrev').classList.toggle('hide', isDex);
    $('btnJrNext').classList.toggle('hide', isDex);
    if (isDex) refreshDex(); else renderJournalDay();
  }

  function jrPrev() {
    if (jrMode !== 'journal' || jrIdx <= 0) return;
    jrIdx--; renderJournalDay();
  }
  function jrNext() {
    if (jrMode !== 'journal' || jrIdx >= PROGRESS.journal.length - 1) return;
    jrIdx++; renderJournalDay();
  }

  /* ── 일지 페이지 — 날짜 한 장. < / > 로 다른 날을 넘겨본다 ── */
  function renderJournalDay() {
    var js = PROGRESS.journal;
    var btnPrev = $('btnJrPrev'), btnNext = $('btnJrNext');
    if (!js.length) {
      $('nbDay').textContent = PROGRESS.day + '일째';
      $('nbTotal').textContent = wonText(0);
      $('nbDepth').textContent = '0.0m';
      $('nbPageIdx').textContent = '';
      $('jrLines').innerHTML = '';
      $('jrEmptyDay').textContent = '아직 물질한 날이 없다.';
      $('jrEmptyDay').classList.add('on');
      btnPrev.disabled = true; btnNext.disabled = true;
      return;
    }
    jrIdx = clamp(jrIdx, 0, js.length - 1);
    var e = js[jrIdx], has = e.lines && e.lines.length;
    $('nbDay').textContent = e.day + '일째';
    $('nbTotal').textContent = wonText(e.total);
    $('nbDepth').textContent = (e.depth || 0).toFixed(1) + 'm';
    $('nbPageIdx').textContent = (jrIdx + 1) + ' / ' + js.length + '일';
    if (has) {
      $('jrLines').innerHTML = journalLinesHTML(e.lines);
      $('jrEmptyDay').classList.remove('on');
    } else {
      $('jrLines').innerHTML = '';
      $('jrEmptyDay').textContent = '이 날은 특별히 적을 말이 없었다.';
      $('jrEmptyDay').classList.add('on');
    }
    btnPrev.disabled = (jrIdx <= 0);
    btnNext.disabled = (jrIdx >= js.length - 1);
  }

  function doSell() {
    if (!settleData) return;
    if (settleData.total > 0) { addMoney(settleData.total); AUDIO.sfx('sell'); }
    overlay('ovSettle', false);
    PROGRESS.day++;
    SAVE.save();
    GAME.goto('bulteok');   /* onStateChange 가 applyHomeHints()+refreshBulteok() 를 이미 호출한다 */

    /* ★ 안전망 — hinted 인 채로 물때 2회가 지나면 동료 말풍선을 한 번만 (모달 아님) */
    var due = tickHomeHintSafety();
    for (var i = 0; i < due.length; i++) {
      var h = HOME_BY_ID[due[i]];
      toast(LINES[h.revealLine], RENDER.allyHeadPos());
    }

    /* 승급은 여전히 모달 연출 */
    seq = [];
    queuePromotion();
    if (seq.length) { GAME.pause(true); runSeq(); }
    settleData = null;
  }


  /* ============================================================
     도감 — 6×2. 미획득은 실루엣만
     ============================================================ */
  function refreshDex() {
    var grid = $('dexGrid');
    grid.innerHTML = '';
    for (var i = 0; i < SPECIES.length; i++) {
      var sp = SPECIES[i];
      var got = dexHas(sp.id);
      var cell = document.createElement('div');
      cell.className = 'dcell' + (got ? '' : ' locked') + (sp.kind === 'observe' ? ' observe' : '');
      var cnv = document.createElement('canvas');
      cnv.width = 84; cnv.height = 84;
      cell.appendChild(cnv);
      var nm = document.createElement('div');
      nm.className = 'dn';
      nm.textContent = got ? sp.name : '?';
      cell.appendChild(nm);
      var no = document.createElement('span');
      no.className = 'no'; no.textContent = (i + 1);
      cell.appendChild(no);
      if (sp.kind === 'observe') {
        var ob = document.createElement('span');
        ob.className = 'ob'; ob.textContent = '관찰';
        cell.appendChild(ob);
      }
      RENDER.drawDexIcon(cnv, sp, !got);
      if (got) {
        (function (s) { cell.addEventListener('click', function () { showDexPop(s); }); })(sp);
      }
      grid.appendChild(cell);
    }
    var n = dexCount();
    $('dexCount').innerHTML = '<b>' + n + '</b> / ' + DEX_TOTAL;
    var sf = rankShortfall();
    $('dexNeed').textContent = (sf && sf.dexLeft > 0)
      ? sf.rank.name + ' 승급까지 ' + sf.dexLeft + '종'
      : (sf ? sf.rank.name + ' 승급 도감 조건 충족' : '');
  }

  function showDexPop(sp) {
    $('dexName').textContent = sp.name;
    $('dexKind').textContent = sp.kind === 'observe' ? '관찰 전용 — 채집할 수 없다' : '채집';
    /* 정확한 시세를 주장하지 않기 위해 도감에는 가격을 표시하지 않는다 */
    $('dexFacts').innerHTML = sp.info.join('<br>');
    $('dexVoice').textContent = '“' + sp.voice + '”';
    var cnv = $('dexShotCv');
    var g = cnv.getContext('2d');
    g.setTransform(1,0,0,1,0,0);
    g.clearRect(0, 0, cnv.width, cnv.height);
    if (DEX_SHOTS[sp.id]) {
      g.drawImage(DEX_SHOTS[sp.id], 0, 0, cnv.width, cnv.height);
      $('dexShotTag').textContent = '내가 만난 순간';
    } else {
      RENDER.drawDexFallback(cnv, sp);
      $('dexShotTag').textContent = '기록';
    }
    overlay('dexPop', true);
  }


  /* ============================================================
     설정
     ============================================================ */
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('sumbi_set'));
      if (s) for (var k in SETTINGS) if (s[k] !== undefined) SETTINGS[k] = s[k];
    } catch (e) {}
    applySettings();
  }
  function saveSettings() { try { localStorage.setItem('sumbi_set', JSON.stringify(SETTINGS)); } catch (e) {} }

  function applySettings() {
    AUDIO.applySettings();
    RENDER.resize();
    syncSettingsUI();
    saveSettings();
  }

  function syncSettingsUI() {
    $('sVolM').value = SETTINGS.volMaster;
    $('sVolS').value = SETTINGS.volSfx;
    $('sVolB').value = SETTINGS.volBgm;
    var qb = $('sQual').children;
    for (var i = 0; i < qb.length; i++) qb[i].classList.toggle('on', +qb[i].dataset.q === SETTINGS.quality);
  }


  /* ============================================================
     HUD
     ============================================================ */
  function tick() {
    var G = GAME.G;
    if (G.state !== 'dive') return;

    var o2r = clamp(G.o2 / G.o2Max, 0, 1);
    $('o2Fill').style.height = (o2r * 100) + '%';
    $('o2Txt').textContent = Math.round(G.o2);
    $('o2Bar').classList.toggle('mulsum', G.mulsum);
    /* 물숨 라인 표시 — 이 구간에 문화적 이름이 붙어 있다 */
    $('o2Line').style.bottom = CONFIG.MULSUM_THRESHOLD + '%';

    $('bagKg').innerHTML = G.bagW.toFixed(1) + '<small> / ' + G.weightMax.toFixed(1) + 'kg</small>';
    $('bagCnt').textContent = G.bag.length + '개 · 비운 것 ' + G.banked.length + '개';

    var t = Math.max(0, G.tide);
    $('tideT').textContent = Math.floor(t / 60) + ':' + ('0' + Math.floor(t % 60)).slice(-2);

    /* 수심 눈금자 — 0(수면)~이 바당 최대 수심 사이의 비율로 마커를 내린다 */
    var dRatio = clamp(GAME.depthM() / G.badang.depthM, 0, 1);
    $('drMarker').style.top = (dRatio * 100) + '%';
    $('drDepthTxt').textContent = GAME.depthM().toFixed(1) + 'm';

    if (DBG.on) DBG.update();
  }


  /* ── 디버그 — 관찰 3종을 즉시 등장시킨다 ──
     ★ 원래는 물때당 1회, tide 가 정해진 시점(at)에 내려갔을 때만 자연스럽게
       나타난다(updateObservers 의 tide 트리거). 테스트용으로 그 트리거를
       건너뛰고 플레이어 바로 옆에서 바로 헤엄쳐 지나가게 만든다 — 조우 판정
       (거리 체크·도감 기록)은 원래 로직 그대로 재사용된다. */
  function spawnObserverDebug(id) {
    var G = GAME.G;
    if (G.state !== 'dive') return;
    var sp = SPECIES_BY_ID[id];
    if (!sp) return;
    var o = null;
    for (var i = 0; i < G.observers.length; i++) { if (G.observers[i].id === id) { o = G.observers[i]; break; } }
    if (!o) { o = { id: id, alive: false, done: false, at: 0, x: 0, y: 0, dir: 1, fade: 0 }; G.observers.push(o); }
    var P = G.player;
    o.dir = Math.random() < 0.5 ? 1 : -1;
    o.x = clamp(P.x - o.dir * 260, 0, CONFIG.WORLD_WIDTH);
    var band = clamp(GAME.depthM(), sp.minD, sp.maxD);
    o.y = Math.min(band * CONFIG.PIXELS_PER_METER, G.badang.depthM * CONFIG.PIXELS_PER_METER - 20);
    o.alive = true; o.done = false; o.fade = 0;
  }

  /* ── 수채화 질감 (실험) — CONFIG.WC_* 를 실제 SVG 필터 속성/CSS 로 반영 ──
     그레인(#wcGrain)은 캔버스와 무관한 정적 오버레이라 여기서 값만
     바꿔주면 끝이고, 번짐(#cv.wc-warp)은 캔버스가 다시 그려질 때마다
     브라우저가 필터를 다시 계산하므로 매 프레임 비용이 붙는다 —
     #dbg 패널의 fps 표시로 켜고 끄며 직접 비교해볼 것. */
  function updateWatercolor() {
    $('wcGrainNoise').setAttribute('baseFrequency', CONFIG.WC_GRAIN_FREQ);
    $('wcGrainAlpha').setAttribute('slope', CONFIG.WC_GRAIN_ALPHA);
    $('wcGrain').style.opacity = CONFIG.WC_GRAIN_ON ? CONFIG.WC_GRAIN_OPACITY : 0;

    $('cv').classList.toggle('wc-warp', !!CONFIG.WC_WARP_ON);
    $('wcWarpNoise').setAttribute('baseFrequency', CONFIG.WC_WARP_FREQ);
    $('wcWarpDisp').setAttribute('scale', CONFIG.WC_WARP_SCALE);
  }

  /* ============================================================
     디버그 패널
     ★ CONFIG.DEV === false 이면 DOM 생성과 `~` 키 핸들러 등록 자체를 건너뜁니다.
     ============================================================ */
  var DBG = {
    on: false,
    el: null,
    statEl: null,

    groups: [
      ['무게 ★', [
        ['WEIGHT_ASCEND_PENALTY', 0, 1, 0.01, '★ 0 과 0.8 로 한 판씩 — 체감이 확실히 달라야 한다'],
        ['WEIGHT_MOVE_PENALTY', 0, 1, 0.01, ''],
        ['WEIGHT_SINK_BIAS', 0, 2, 0.05, '입력이 없을 때 끌려 내려가는 힘']
      ]],
      ['조작', [
        ['FOLLOW_TAU_BASE', 0.05, 1.2, 0.01, '★ 클수록 무겁게 따라온다'],
        ['FOLLOW_TAU_WEIGHT', 0, 1.2, 0.01, '★ 만재일 때 더해지는 지연'],
        ['DRAG_QUADRATIC', 0, 1.5, 0.01, '물의 점성'],
        ['POINTER_FULL_DIST', 40, 300, 5, '최대 속도가 나오는 드래그 거리'],
        ['ANGLE_TURN_RATE', 1, 14, 0.2, '회전 속도'],
        ['SNAP_FORCE', 0, 8, 0.1, '흡착 세기']
      ]],
      ['산소', [
        ['O2_DRAIN_ASCEND', 0.5, 6, 0.1, ''],
        ['O2_DEPTH_FACTOR', 0, 0.1, 0.002, '수심 가중'],
        ['MULSUM_THRESHOLD', 5, 50, 1, '물숨 라인 (%)'],
        ['MULSUM_BONUS', 1, 4, 0.1, '★ 욕심이 실제로 이득이 되는 지점']
      ]],
      ['카메라 ★', [
        ['CHAR_HEIGHT_PCT', 0.04, 0.18, 0.005, '캐릭터가 화면 높이의 몇 %'],
        ['CAM_ZOOM_DEEP', 0.7, 1.2, 0.01, '★ 아트 후 재확인'],
        ['CAM_ZOOM_SURFACE', 0.5, 1.2, 0.01, '★ 출수. 하늘·수평선·동료가 드러나는가']
      ]],
      ['가시성 1·2층', [
        ['VIS_DEPTH_REF', 10, 40, 1, '★ 전 스테이지 공통 절대 기준'],
        ['DEPTH_ATTEN_MAX', 0, 1, 0.01, ''],
        ['VIS_RADIUS_SHALLOW', 400, 1400, 10, ''],
        ['VIS_RADIUS_DEEP', 200, 1200, 10, '★ 심해에서 "무섭다"가 아니라 "조심스럽다"'],
        ['VIS_SOFTNESS', 0.05, 0.95, 0.01, ''],
        ['VIS_TINT_ALPHA', 0, 1, 0.01, '']
      ]],
      ['빛기둥 3층', [
        ['LIGHT_SHAFT_WIDTH_SHALLOW', 40, 400, 5, ''],
        ['LIGHT_SHAFT_WIDTH_DEEP', 0, 300, 5, ''],
        ['LIGHT_SHAFT_EDGE_SOFT', 0, 1, 0.01, '0 = 딱 끊기는 면'],
        ['LIGHT_SHAFT_ALPHA', 0, 0.5, 0.005, ''],
        ['LIGHT_SHAFT_SWAY', 0, 1.5, 0.05, '']
      ]],
      ['반짝임 · 산소 · 랜턴', [
        ['GLINT_ALPHA', 0, 1.2, 0.01, '★ 0 으로 내려 심해가 답답해지면 필요한 기능이 맞다'],
        ['GLINT_RADIUS', 8, 70, 1, ''],
        ['O2_DESAT', 0, 1, 0.01, '★ 수심 어둠과 다른 감각인가'],
        ['O2_DARKEN', 0, 1, 0.01, ''],
        ['VIGNETTE_MAX', 0, 1, 0.01, '높이면 중심이 밝아 보이는 착시'],
        ['LANTERN_GLOW_ALPHA', 0, 0.6, 0.01, '★ 켰을 때 편안해지면 너무 밝다'],
        ['LANTERN_COLOR_RADIUS', 60, 400, 5, '']
      ]],
      ['채집 저항 ★', [
        ['STAGE2_SPEED', 0.2, 2, 0.05, '★ 낮을수록 버티기 구간이 빡빡해진다'],
        ['PULL_MULT', 0, 2.5, 0.05, '채집 중 밀려나는 힘 전체'],
        ['KNOCKBACK', 0, 16, 0.5, '완료 순간 반동'],
        ['CAM_KICK', 0, 20, 0.5, '완료 순간 카메라 킥'],
        ['HITSTOP_MS', 0, 300, 10, '완료 순간 정지 시간(ms)'],
        ['FLY_DURATION', 0.1, 1.2, 0.02, '망사리로 날아가는 시간'],
        ['TREMBLE', 0, 14, 0.5, '버티기 구간 떨림 크기'],
        ['SLIP_CHANCE', 0, 1, 0.02, '버티기 통과 시 미끄러질 확률']
      ]],
      ['근수면선 — 포말·발광', [
        ['FOAM', 0, 1, 0.02, '★ 0 이면 파도 위 흰 줄이 완전히 사라진다'],
        ['SUBSURF_GLOW', 0, 1, 0.02, '★ 0 이면 수면 바로 아래 밝은 띠가 사라진다']
      ]],
      ['수채화 질감 (실험)', [
        ['WC_GRAIN_ON', 0, 1, 1, '종이 그레인 — 정적 오버레이, 사실상 공짜'],
        ['WC_GRAIN_FREQ', 0.3, 2, 0.05, '그레인 알갱이 크기 (낮을수록 큼)'],
        ['WC_GRAIN_ALPHA', 0, 1, 0.02, '그레인 대비'],
        ['WC_GRAIN_OPACITY', 0, 1, 0.02, '그레인 전체 강도'],
        ['WC_WARP_ON', 0, 1, 1, '★ 붓 번짐 — 캔버스 자체를 매 프레임 왜곡. fps 확인할 것'],
        ['WC_WARP_FREQ', 0.005, 0.05, 0.001, '번짐 결 크기 (낮을수록 큰 붓자국)'],
        ['WC_WARP_SCALE', 0, 20, 0.5, '번짐 강도(px)']
      ]]
    ],

    /* ★ 배경 색상 — RENDER.COL 은 전역(모든 바당 공통), tint/rockCol 은
       BADANG[] 각 항목에 있어 "현재 바당"에만 적용된다(요청서 §바당 3곳).
       여기 없는 COL.rock/kelp 는 실제로 화면에 쓰이지 않는 죽은 값이라
       넣지 않았다 — 넣으면 "바꿔도 안 바뀐다"는 혼란만 생긴다. */
    colorRows: [
      ['skyTop', '하늘 위쪽'],
      ['skyLow', '하늘 아래쪽 (수평선)'],
      ['waterTop', '먼바다 (수평선 ~ 근수면선)'],
      ['waterDeep', '깊은 물 (심해 기준색)'],
      ['fog', '가시거리 안개'],
      ['tewak', '테왁 부표'],
      ['diver', '해녀 — 스프라이트 없을 때 폴백색'],
      ['ally', '동료 해녀'],
      ['sand', '모래 파티클'],
      ['foam', '포말 (파도 위 흰 줄) — 위 FOAM 슬라이더가 0 이면 안 보임'],
      ['foamGlow', '포말 보조선'],
      ['subsurfGlow', '표층 발광 (수면 바로 아래) — 위 SUBSURF_GLOW 가 0 이면 안 보임']
    ],
    stageColorRows: [
      ['tint', '수면 근처 바닷물 색'],
      ['rockCol', '바위 기준색 — 실제로는 이 색을 기준으로 수면 쪽은 밝게, 심해 쪽은 어둡게 자동 그라데이션됨']
    ],
    colorDefaults: null,   /* build() 에서 딥카피로 채운다 — "색상 초기화" 용 */

    build: function () {
      var el = $('dbg');
      DBG.el = el;
      var html = '<div style="font-size:12px;color:#7fc9d8;font-weight:700">DEV — ` 키로 토글</div>' +
                 '<div id="dbgStat"></div>';
      for (var g = 0; g < DBG.groups.length; g++) {
        html += '<h4>' + DBG.groups[g][0] + '</h4>';
        var rows = DBG.groups[g][1];
        for (var i = 0; i < rows.length; i++) {
          var k = rows[i][0];
          html += '<div class="dr"><div class="dl"><span>' + k + '</span><b id="dv_' + k + '">' + CONFIG[k] + '</b></div>' +
                  '<input type="range" id="ds_' + k + '" min="' + rows[i][1] + '" max="' + rows[i][2] +
                  '" step="' + rows[i][3] + '" value="' + CONFIG[k] + '">' +
                  (rows[i][4] ? '<div class="dd">' + rows[i][4] + '</div>' : '') + '</div>';
        }
      }

      /* ── 배경 색상 ── */
      if (!DBG.colorDefaults) {
        DBG.colorDefaults = { col: {}, stage: {} };
        for (var ci = 0; ci < DBG.colorRows.length; ci++) {
          var ck = DBG.colorRows[ci][0];
          DBG.colorDefaults.col[ck] = RENDER.COL[ck].slice();
        }
        for (var si = 0; si < DBG.stageColorRows.length; si++) {
          var sk = DBG.stageColorRows[si][0];
          DBG.colorDefaults.stage[sk] = {};
          for (var bi = 0; bi < BADANG.length; bi++) DBG.colorDefaults.stage[sk][BADANG[bi].id] = BADANG[bi][sk].slice();
        }
      }
      html += '<h4>배경 색상 — 전역</h4>';
      for (var c1 = 0; c1 < DBG.colorRows.length; c1++) {
        var cg = DBG.colorRows[c1][0];
        html += '<div class="dc-row"><input type="color" id="dc_col_' + cg + '" value="' + hexOf(RENDER.COL[cg]) + '">' +
                '<span>' + DBG.colorRows[c1][1] + '</span><code id="dcv_col_' + cg + '">' + hexOf(RENDER.COL[cg]) + '</code></div>';
      }
      html += '<h4>배경 색상 — 현재 바당</h4><div class="dd" style="margin-bottom:6px">지금 뜬 바당(<b id="dc_stage_name">' +
              GAME.G.badang.name + '</b>)에만 적용됩니다. 다른 바당으로 가면 그 바당의 색으로 바뀝니다.</div>';
      for (var c2 = 0; c2 < DBG.stageColorRows.length; c2++) {
        var sg = DBG.stageColorRows[c2][0];
        html += '<div class="dc-row"><input type="color" id="dc_stage_' + sg + '" value="' + hexOf(GAME.G.badang[sg]) + '">' +
                '<span>' + DBG.stageColorRows[c2][1] + '</span><code id="dcv_stage_' + sg + '">' + hexOf(GAME.G.badang[sg]) + '</code></div>';
      }

      html += '<h4>바로가기</h4><div class="db">' +
              '<button data-a="b1">여</button><button data-a="b2">감태숲</button><button data-a="b3">깊은 여</button>' +
              '<button data-a="money">돈 +50,000</button><button data-a="gear">장비 전체</button>' +
              '<button data-a="rank">승급 강제</button><button data-a="home">살림 전체 공개</button>' +
              '<button data-a="dex">도감 전체</button><button data-a="o2">산소 무한</button>' +
              '<button data-a="tidepause">물때 타이머 정지/재개</button>' +
              '<button data-a="regen">스테이지 재생성</button><button data-a="dump">CONFIG → 콘솔</button>' +
              '<button data-a="colorDump">색상 → 콘솔</button><button data-a="colorReset">색상 초기화</button>' +
              '<button data-a="reset">저장 삭제</button></div>' +
              '<h4>관찰 3종 — 바로 등장 (잠수 중)</h4><div class="db">' +
              '<button data-a="ob_dolphin">돌고래 등장</button>' +
              '<button data-a="ob_turtle">거북 등장</button>' +
              '<button data-a="ob_ray">가오리 등장</button></div>';
      el.innerHTML = html;
      DBG.statEl = $('dbgStat');

      for (var c3 = 0; c3 < DBG.colorRows.length; c3++) {
        (function (key) {
          $('dc_col_' + key).addEventListener('input', function () {
            setFromHex(RENDER.COL[key], this.value);
            $('dcv_col_' + key).textContent = this.value;
            if (key === 'fog') RENDER.invalidateFog();
          });
        })(DBG.colorRows[c3][0]);
      }
      for (var c4 = 0; c4 < DBG.stageColorRows.length; c4++) {
        (function (key) {
          $('dc_stage_' + key).addEventListener('input', function () {
            setFromHex(GAME.G.badang[key], this.value);
            $('dcv_stage_' + key).textContent = this.value;
          });
        })(DBG.stageColorRows[c4][0]);
      }

      for (var g2 = 0; g2 < DBG.groups.length; g2++) {
        var rows2 = DBG.groups[g2][1];
        for (var j = 0; j < rows2.length; j++) {
          (function (key) {
            $('ds_' + key).addEventListener('input', function () {
              CONFIG[key] = parseFloat(this.value);
              $('dv_' + key).textContent = CONFIG[key];
              if (key.indexOf('LIGHT_SHAFT') === 0) RENDER.invalidateShaft();
              if (key.indexOf('VIS_') === 0) RENDER.invalidateFog();
              if (key.indexOf('WC_') === 0) updateWatercolor();
            });
          })(rows2[j][0]);
        }
      }

      el.addEventListener('click', function (e) {
        var a = e.target.dataset && e.target.dataset.a;
        if (!a) return;
        var G = GAME.G;
        if (a === 'b1') GAME.startDive(1);
        if (a === 'b2') GAME.startDive(2);
        if (a === 'b3') GAME.startDive(3);
        if (a === 'money') { addMoney(50000); refreshBulteok(); }
        if (a === 'gear') { PROGRESS.gear = { tewak:3, mangsari:3, muloht:3 }; PROGRESS.firstGearBought = true; SAVE.save(); refreshBulteok(); }
        if (a === 'rank') { var r = RANKS[rankIdx()+1]; if (r) { PROGRESS.rank = r.id; if (r.grantLantern) PROGRESS.lantern = true; SAVE.save(); refreshBulteok(); } }
        if (a === 'home') {
          PROGRESS.firstGearBought = true;
          PROGRESS.homeState = { pot:'known', books:'known', field:'known' };
          SAVE.save(); refreshBulteok();
        }
        if (a === 'dex') { for (var i = 0; i < SPECIES.length; i++) PROGRESS.dex[SPECIES[i].id] = true; SAVE.save(); refreshBulteok(); }
        if (a === 'o2') { DBG.infO2 = !DBG.infO2; }
        if (a === 'tidepause') { G.tidePaused = !G.tidePaused; }
        if (a === 'regen') GAME.generateStage(G.badang);
        if (a === 'ob_dolphin') spawnObserverDebug('dolphin');
        if (a === 'ob_turtle') spawnObserverDebug('turtle');
        if (a === 'ob_ray') spawnObserverDebug('ray');
        if (a === 'dump') { console.log(JSON.stringify(CONFIG, null, 2)); }
        if (a === 'colorDump') {
          var dump = { COL: {} };
          for (var di = 0; di < DBG.colorRows.length; di++) { var dk = DBG.colorRows[di][0]; dump.COL[dk] = RENDER.COL[dk].slice(); }
          dump.BADANG = {};
          for (var dj = 0; dj < BADANG.length; dj++) {
            var bd = BADANG[dj], row = {};
            for (var dsi = 0; dsi < DBG.stageColorRows.length; dsi++) { var dsk = DBG.stageColorRows[dsi][0]; row[dsk] = bd[dsk].slice(); }
            dump.BADANG[bd.key] = row;
          }
          console.log(JSON.stringify(dump, null, 2));
          toast('색상 값을 콘솔에 출력했습니다 (F12)');
        }
        if (a === 'colorReset') {
          var cd = DBG.colorDefaults;
          if (cd) {
            for (var ri = 0; ri < DBG.colorRows.length; ri++) {
              var rk = DBG.colorRows[ri][0], rv = cd.col[rk];
              RENDER.COL[rk][0] = rv[0]; RENDER.COL[rk][1] = rv[1]; RENDER.COL[rk][2] = rv[2];
              $('dc_col_' + rk).value = hexOf(rv); $('dcv_col_' + rk).textContent = hexOf(rv);
            }
            for (var rsi = 0; rsi < DBG.stageColorRows.length; rsi++) {
              var rsk = DBG.stageColorRows[rsi][0];
              for (var rbi = 0; rbi < BADANG.length; rbi++) {
                var defv = cd.stage[rsk][BADANG[rbi].id];
                BADANG[rbi][rsk][0] = defv[0]; BADANG[rbi][rsk][1] = defv[1]; BADANG[rbi][rsk][2] = defv[2];
              }
              var curv = GAME.G.badang[rsk];
              $('dc_stage_' + rsk).value = hexOf(curv); $('dcv_stage_' + rsk).textContent = hexOf(curv);
            }
            RENDER.invalidateFog();
          }
        }
        if (a === 'reset') { SAVE.reset(); location.reload(); }
      });
    },

    infO2: false,

    /* 바당이 바뀌면(바로가기 버튼 등) 현재 바당의 색상 스와치도 따라가야 한다.
       ★ 드래그 중인 입력은 건드리지 않는다(활성 포커스는 건너뜀). */
    updateStageColorSwatches: function () {
      var badang = GAME.G.badang;
      var nameEl = $('dc_stage_name');
      if (nameEl && nameEl.textContent !== badang.name) nameEl.textContent = badang.name;
      for (var i = 0; i < DBG.stageColorRows.length; i++) {
        var key = DBG.stageColorRows[i][0];
        var input = $('dc_stage_' + key);
        if (!input || document.activeElement === input) continue;
        var hex = hexOf(badang[key]);
        if (input.value !== hex) { input.value = hex; $('dcv_stage_' + key).textContent = hex; }
      }
    },

    update: function () {
      var G = GAME.G, s = GAME.stats();
      if (DBG.infO2 && G.state === 'dive') G.o2 = G.o2Max;
      DBG.updateStageColorSwatches();
      DBG.statEl.textContent =
        'fps ' + s.fps.toFixed(0) + '  update ' + s.updateMs.toFixed(2) + 'ms  render ' + s.renderMs.toFixed(2) + 'ms\n' +
        'depth ' + GAME.depthM().toFixed(1) + 'm  o2 ' + G.o2.toFixed(0) + '/' + G.o2Max +
          '  tide ' + G.tide.toFixed(0) + '/' + G.tideMax + (G.tidePaused ? ' (정지됨)' : '') + '\n' +
        'bag ' + G.bagW.toFixed(1) + '/' + G.weightMax + 'kg  wr ' + GAME.weightRatio().toFixed(2) + '\n' +
        'ascend ' + GAME.ascendSpeed().toFixed(2) + ' m/s   tau ' +
          (CONFIG.FOLLOW_TAU_BASE + GAME.weightRatio() * CONFIG.FOLLOW_TAU_WEIGHT).toFixed(2) + 's\n' +
        'play ' + (PROGRESS.stat.playSec/60).toFixed(1) + 'min  day ' + PROGRESS.day +
          '  dex ' + dexCount() + '  ₩' + PROGRESS.money;
    },

    toggle: function () {
      DBG.on = !DBG.on;
      DBG.el.classList.toggle('on', DBG.on);
    }
  };


  /* ============================================================
     부팅
     ============================================================ */
  function boot() {
    stage = $('stage'); wrap = $('wrap');
    RENDER.init($('cv'));
    INPUT.init(stage);
    loadSettings();
    resizeStage();
    window.addEventListener('resize', resizeStage);
    window.addEventListener('orientationchange', function () { setTimeout(resizeStage, 120); });

    /* 터치 기기 판정 — 모바일 버튼 표시 */
    if (('ontouchstart' in window) || navigator.maxTouchPoints > 0) document.body.classList.add('touch');

    /* ── 버튼 배선 ── */
    bind($('btnStart'), startNew);
    bind($('btnContinue'), continueGame);
    bind($('btnTitleSet'), function () { overlay('ovSet', true); });
    bind($('btnHowClose'), function () {
      PROGRESS.seenHowto = true; SAVE.save();
      $('howto').classList.remove('on');
      fadeTo(function () {
        GAME.pause(false);
        GAME.goto('bulteok');
      });
    });

    bind($('btnJournal'), function () { GAME.goto('journal'); });
    bind($('btnJournalBack'), function () { GAME.goto('bulteok'); });
    bind($('nbTab'), toggleJournalMode);
    bind($('btnJrPrev'), jrPrev);
    bind($('btnJrNext'), jrNext);
    bindBadangCarousel();
    bind($('btnSet'), function () { overlay('ovSet', true); });
    bind($('btnToTitle'), function () { SAVE.save(); GAME.goto('title'); });
    bind($('btnSetClose'), function () { overlay('ovSet', false); });
    bind($('btnDexPopClose'), function () { overlay('dexPop', false); });
    bind($('btnSell'), doSell);
    bind($('btnRankOk'), function () { overlay('ovRank', false); runSeq(); });
    bind($('btnLineOk'), function () { overlay('ovLine', false); runSeq(); });

    for (var i = 0; i < HOME_SPOTS.length; i++) {
      (function (spot) { bind($('hs-' + spot), function () { onHomeHotspotClick(spot); }); })(HOME_SPOTS[i]);
    }
    $('homeCardBuy').addEventListener('click', buyHomeFromCard);   /* AUDIO.sfx('upgrade') 는 구매 성공시 직접 재생 */

    /* 방출 — PC·모바일 공통 좌하단 아이콘 버튼.
       상승 버튼은 없앴다(PC 는 Space, 모바일은 위로 드래그). */
    $('btnLetout').addEventListener('pointerdown', function (e) {
      e.preventDefault(); INPUT.requestRelease();
    });

    /* 설정 */
    $('sVolM').addEventListener('input', function () { SETTINGS.volMaster = +this.value; applySettings(); });
    $('sVolS').addEventListener('input', function () { SETTINGS.volSfx = +this.value; applySettings(); });
    $('sVolB').addEventListener('input', function () { SETTINGS.volBgm = +this.value; applySettings(); });
    var qb = $('sQual').children;
    for (var q = 0; q < qb.length; q++) {
      (function (btn) { bind(btn, function () { SETTINGS.quality = +btn.dataset.q; applySettings(); }); })(qb[q]);
    }

    /* ★ 수채화 질감은 확정된 기본 비주얼이라 DEV 여부와 무관하게 항상 적용된다.
       #dbg 패널(DEV 전용)은 이 값을 실행 중에 조절하는 도구일 뿐이다. */
    updateWatercolor();

    /* ★ DEV 가 false 이면 디버그 패널을 아예 만들지 않고 키 핸들러도 걸지 않는다 */
    if (CONFIG.DEV) {
      DBG.build();
      window.addEventListener('keydown', function (e) {
        if (e.key === '`' || e.key === '~') DBG.toggle();
      });
    }

    /* 에셋 프리로드 후 시작 (없으면 즉시 도형 폴백) */
    RENDER.preload(function () {
      $('loading').classList.add('off');
      GAME.goto('title');
      GAME.start();
    });
  }

  window.addEventListener('load', boot);

  return {
    toast: toast, onStateChange: onStateChange, tick: tick,
    showSettle: showSettle, refreshBulteok: refreshBulteok, refreshDex: refreshDex,
    applySettings: applySettings
  };
})();
