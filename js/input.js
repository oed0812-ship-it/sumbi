/* ============================================================
   숨비 (SUMBI) — input.js
   조작. 마우스와 키보드는 동시 지원, 모드 전환 없이 마지막 입력 우선.

   ★ 목표물 클릭 후 자동 이동은 구현하지 않습니다.
     무게 저항감이 사라지고, 이 게임에서 가장 중요한
     "가다가 돌아서는 순간"이 클릭 한 번으로 축소되기 때문입니다.
     길찾기도 없습니다.

   ★ e.pointerType === 'touch' → 상대 드래그(끄는 방향)
     그 외              → 절대(커서 방향)
     모바일에서 목적지를 짚으면 손가락이 그곳을 가려
     안개 낀 심해에서 답답해집니다.
   ============================================================ */
var SUMBI = SUMBI || {};

var INPUT = (function () {

  var stage = null;      /* 논리 좌표 변환용 */

  var state = {
    /* 이동 의도 벡터 (논리 픽셀). game.js 가 POINTER_FULL_DIST 로 정규화 */
    dx: 0, dy: 0, active: false,
    ascend: false,        /* Space 홀드 / 모바일 상승 버튼 */
    releaseEdge: false,   /* Shift 눌린 프레임 / 모바일 방출 버튼 */
    escEdge: false,
    isTouch: false,       /* 마지막 포인터가 터치였는가 */
    lastSrc: 'key'
  };

  /* ── 포인터 ── */
  var ptr = {
    down: false, touch: false,
    /* 절대 모드: 커서의 논리 좌표 */
    x: 0, y: 0,
    /* 상대 모드: 드래그 시작점 */
    ox: 0, oy: 0
  };

  /* ── 키보드 ── */
  var keys = {};

  /* 화면 좌표 → 논리 좌표(960×600) */
  function toLogical(clientX, clientY) {
    if (!stage) return { x: 0, y: 0 };
    var r = stage.getBoundingClientRect();
    var sx = r.width / CONFIG.VIEW_W, sy = r.height / CONFIG.VIEW_H;
    return { x: (clientX - r.left) / sx, y: (clientY - r.top) / sy };
  }

  function onDown(e) {
    /* UI 버튼 위에서 시작한 포인터는 이동 입력으로 쓰지 않는다 */
    if (e.target && e.target.closest && e.target.closest('#ui > *:not(#hud)')) return;
    if (e.target && e.target.closest && e.target.closest('.tbtn')) return;
    if (e.button !== undefined && e.button !== 0) return;

    ptr.down = true;
    ptr.touch = (e.pointerType === 'touch');
    state.isTouch = ptr.touch;
    state.lastSrc = 'pointer';
    var p = toLogical(e.clientX, e.clientY);
    ptr.x = p.x; ptr.y = p.y; ptr.ox = p.x; ptr.oy = p.y;
    if (e.cancelable) e.preventDefault();
  }

  function onMove(e) {
    if (!ptr.down) return;
    var p = toLogical(e.clientX, e.clientY);
    ptr.x = p.x; ptr.y = p.y;
    state.lastSrc = 'pointer';
    if (e.cancelable) e.preventDefault();
  }

  function onUp() { ptr.down = false; }

  /* ── 키 ── */
  var KEYMAP = {
    arrowleft:'l', a:'l', arrowright:'r', d:'r',
    arrowup:'u',   w:'u', arrowdown:'d',  s:'d'
  };

  function onKeyDown(e) {
    var k = (e.key || '').toLowerCase();
    if (KEYMAP[k]) { keys[KEYMAP[k]] = true; state.lastSrc = 'key'; e.preventDefault(); }
    if (k === ' ' || k === 'spacebar') { state.ascend = true; e.preventDefault(); }
    if (k === 'shift') state.releaseEdge = true;
    if (k === 'escape') state.escEdge = true;
  }

  function onKeyUp(e) {
    var k = (e.key || '').toLowerCase();
    if (KEYMAP[k]) keys[KEYMAP[k]] = false;
    if (k === ' ' || k === 'spacebar') state.ascend = false;
  }

  /* ── 매 프레임 호출: 플레이어 화면 위치를 받아 의도 벡터를 만든다 ── */
  function sample(playerScreenX, playerScreenY) {
    var kx = (keys.r ? 1 : 0) - (keys.l ? 1 : 0);
    var ky = (keys.d ? 1 : 0) - (keys.u ? 1 : 0);
    var hasKey = (kx !== 0 || ky !== 0);

    /* 마지막 입력 우선. 키를 놓으면 포인터가 다시 살아난다 */
    if (hasKey && (state.lastSrc === 'key' || !ptr.down)) {
      var m = Math.hypot(kx, ky) || 1;
      state.dx = kx / m * CONFIG.POINTER_FULL_DIST;
      state.dy = ky / m * CONFIG.POINTER_FULL_DIST;
      state.active = true;
      return state;
    }

    if (ptr.down) {
      if (ptr.touch) {
        /* 상대 드래그 — 끄는 방향 */
        state.dx = ptr.x - ptr.ox;
        state.dy = ptr.y - ptr.oy;
      } else {
        /* 절대 — 커서 방향 */
        state.dx = ptr.x - playerScreenX;
        state.dy = ptr.y - playerScreenY;
      }
      state.active = true;
      return state;
    }

    state.dx = 0; state.dy = 0; state.active = false;
    return state;
  }

  /* 엣지 플래그는 읽은 쪽이 소비한다 */
  function consumeRelease() { var v = state.releaseEdge; state.releaseEdge = false; return v; }
  function consumeEsc()     { var v = state.escEdge;     state.escEdge = false;     return v; }

  function setAscend(v) { state.ascend = !!v; }
  function requestRelease() { state.releaseEdge = true; }

  function clear() {
    ptr.down = false; state.ascend = false;
    state.dx = state.dy = 0; state.active = false;
    state.releaseEdge = state.escEdge = false;
    keys = {};
  }

  function init(stageEl) {
    stage = stageEl;
    stage.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive:false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', clear);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('contextmenu', function (e) {
      if (e.target && e.target.id === 'cv') e.preventDefault();
    });
  }

  return {
    init: init, sample: sample, state: state, clear: clear,
    consumeRelease: consumeRelease, consumeEsc: consumeEsc,
    setAscend: setAscend, requestRelease: requestRelease,
    toLogical: toLogical
  };
})();
