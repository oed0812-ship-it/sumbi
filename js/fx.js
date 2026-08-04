/* ============================================================
   숨비 (SUMBI) — fx.js
   연출은 개별 구현하지 않고 부품 4개의 파라미터 조합으로 만든다.

     cameraTween / setTimeScale / playSurfaceBand / audioSweep

   새 연출이 필요하면 COMBO 에 조합 한 줄만 추가하면 됩니다.
   ============================================================ */
var SUMBI = SUMBI || {};

var FX = (function () {

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var EASE = {
    linear:   function (t) { return t; },
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOut:    function (t) { return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2; },
    outBack:  function (t) { var c = 1.70158; return 1 + (c+1)*Math.pow(t-1,3) + c*Math.pow(t-1,2); }
  };

  /* ── 부품 1. 카메라 트윈 ──────────────────────────────────
     phase: in → hold → out → null
     focus 가 있으면 그 월드 좌표를 화면 중앙으로 끌어온다. */
  var zoomT = null;

  function cameraTween(targetZoom, focus, durationSec, easing, holdSec) {
    zoomT = {
      to: targetZoom, focus: focus || null,
      dur: Math.max(0.01, durationSec),
      ease: EASE[easing] || EASE.outCubic,
      hold: holdSec || 0,
      phase: 'in', t: 0,
      from: null,            /* 첫 프레임에 현재값으로 채운다 */
      k: 0                   /* 0=기본 1=목표 */
    };
  }

  function cameraRelease() {
    if (zoomT) { zoomT.phase = 'out'; zoomT.t = 0; }
  }

  function cameraHardRelease() { zoomT = null; }

  /* ── 부품 2. 타임스케일 ───────────────────────────────── */
  var timeScale = 1, tsTarget = 1, tsRate = 8;

  function setTimeScale(value, durationSec) {
    tsTarget = value;
    tsRate = durationSec > 0.001 ? (1 / durationSec) * 2.4 : 999;
  }

  /* ── 부품 3. 수면 통과 띠 ─────────────────────────────── */
  var band = null;   /* { dir:1|-1, t, dur } */

  function playSurfaceBand(direction, durationSec) {
    band = { dir: direction === 'up' ? -1 : 1, t: 0, dur: durationSec || CONFIG.SURFACE_BAND_DURATION };
  }

  /* ── 부품 4. 오디오 스윕 ──────────────────────────────── */
  function audioSweep(cutoffHz, durationSec, masterGain) {
    if (typeof AUDIO !== 'undefined') AUDIO.sweep(cutoffHz, durationSec, masterGain);
  }

  /* ── 화면 흔들림 (보조) ───────────────────────────────── */
  var shakeAmt = 0, shakeT = 0;
  function shake(amount, durationSec) {
    shakeAmt = amount; shakeT = durationSec;
  }

  /* ============================================================
     연출 조합표 — 요청서 12절
     ============================================================ */
  function play(name, opt) {
    opt = opt || {};
    switch (name) {

      /* 입수: 줌은 수심 기반 기본값(1.0→0.97)이 담당한다 */
      case 'dive':
        playSurfaceBand('down', CONFIG.SURFACE_BAND_DURATION);
        audioSweep(CONFIG.LOWPASS_DEEP, 0.9, null);
        break;

      /* ★ 출수 — 가로 화면의 최대 수혜 지점.
         줌 0.75 에서 하늘·수평선·테왁·동료 해녀가 한꺼번에 들어온다. */
      case 'emerge':
        cameraTween(CONFIG.CAM_ZOOM_SURFACE, null, 0.35, 'outCubic', 0.9);
        setTimeScale(CONFIG.TIMESCALE_EMERGE, 0.25);
        setTimeout(function () { setTimeScale(1, 0.4); }, 700);
        playSurfaceBand('up', CONFIG.SURFACE_BAND_DURATION);
        audioSweep(CONFIG.LOWPASS_EMERGE_OPEN, 0.25, null);
        if (typeof AUDIO !== 'undefined') AUDIO.sfx('sumbi');   /* 숨비소리는 줌아웃 시작 프레임에 */
        break;

      /* 물숨 진입 — 줌은 진입 연출이고, 기포 정지·채도 소실은 상태가 유지한다 */
      case 'mulsum':
        cameraTween(CONFIG.CAM_ZOOM_MULSUM, null, 1.2, 'inOut', 1.2);
        setTimeScale(CONFIG.TIMESCALE_MULSUM, 1.2);
        setTimeout(function () { setTimeScale(1, 0.8); }, 2200);
        audioSweep(null, 1.2, 0.32);
        if (typeof AUDIO !== 'undefined') AUDIO.setHeartGain(1.0);
        break;

      /* 첫 조우 — 이 프레임이 캡처되어 도감 카드가 된다 */
      case 'encounter':
        cameraTween(1.3, opt.focus || null, 0.6, 'outCubic', CONFIG.ENCOUNTER_HOLD);
        setTimeScale(CONFIG.TIMESCALE_ENCOUNTER, 0.4);
        setTimeout(function () { setTimeScale(1, 0.6); }, (CONFIG.ENCOUNTER_HOLD + 0.6) * 1000);
        if (typeof AUDIO !== 'undefined') AUDIO.sfx('encounter');
        break;

      /* 실패 — 죽지 않는다. 동료가 끌어올린다 */
      case 'fail':
        cameraTween(1.1, null, 1.0, 'inOut', 2.6);
        setTimeScale(0.5, 0.8);
        audioSweep(220, 1.0, 0.18);
        if (typeof AUDIO !== 'undefined') AUDIO.sfx('fail');
        break;
    }
  }

  /* ============================================================
     기포 — 가장 좋은 산소 신호. 설명이 필요 없다.
     물숨에서는 아예 멈춘다.
     ============================================================ */
  var bubbles = [];
  var BUB_MAX = 120;

  function spawnBubble(x, y, burst) {
    var n = burst ? 9 : 1;
    for (var i = 0; i < n; i++) {
      if (bubbles.length >= BUB_MAX) break;
      bubbles.push({
        x: x + (Math.random() - 0.5) * (burst ? 22 : 8),
        y: y + (Math.random() - 0.5) * 6,
        r: 1.3 + Math.random() * (burst ? 3.4 : 2.2),
        vy: -(24 + Math.random() * 30),
        ph: Math.random() * 6.28,
        life: 1
      });
    }
  }

  function updateBubbles(dt) {
    for (var i = bubbles.length - 1; i >= 0; i--) {
      var b = bubbles[i];
      b.y += b.vy * dt;
      b.x += Math.sin(b.y * 0.045 + b.ph) * 11 * dt;
      b.vy -= 5 * dt;
      if (b.y < -40) { bubbles.splice(i, 1); continue; }
      b.life -= dt * 0.14;
      if (b.life <= 0) bubbles.splice(i, 1);
    }
  }

  function clearBubbles() { bubbles.length = 0; }

  /* ── 흩어지는 채집물 (실패 / 방출) ────────────────────── */
  var scatter = [];
  function spawnScatter(x, y, items) {
    for (var i = 0; i < items.length; i++) {
      var sp = SPECIES_BY_ID[items[i].id];
      scatter.push({
        x: x, y: y, sp: sp,
        vx: (Math.random() - 0.5) * 130,
        vy: -30 - Math.random() * 60,
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 3,
        life: 1.9
      });
    }
  }
  function updateScatter(dt) {
    for (var i = scatter.length - 1; i >= 0; i--) {
      var s = scatter[i];
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.vy += 46 * dt;                 /* 다시 가라앉는다 */
      s.vx *= (1 - 1.4 * dt);
      s.rot += s.vr * dt;
      s.life -= dt * 0.5;
      if (s.life <= 0) scatter.splice(i, 1);
    }
  }
  function clearScatter() { scatter.length = 0; }

  /* ── 모래 파티클 — 채집 저항(손맛) 연출 ────────────────── */
  var sand = [];
  function spawnSand(x, y, n) {
    for (var i = 0; i < n; i++) {
      sand.push({
        x: x + (Math.random() - 0.5) * 14,
        y: y + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 46,
        vy: -(10 + Math.random() * 24),
        r: 0.8 + Math.random() * 1.6,
        life: 0.5 + Math.random() * 0.4
      });
    }
  }
  function updateSand(dt) {
    for (var i = sand.length - 1; i >= 0; i--) {
      var s = sand[i];
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.vy += 70 * dt; s.vx *= (1 - 2 * dt);
      s.life -= dt;
      if (s.life <= 0) sand.splice(i, 1);
    }
  }
  function clearSand() { sand.length = 0; }

  /* ============================================================
     프레임 갱신 — dtRaw(타임스케일 영향 없음)로 호출
     ============================================================ */
  function update(dtRaw, baseZoom) {
    /* 타임스케일 */
    timeScale += (tsTarget - timeScale) * clamp(tsRate * dtRaw, 0, 1);

    /* 카메라 트윈 */
    if (zoomT) {
      if (zoomT.from === null) zoomT.from = baseZoom;
      zoomT.t += dtRaw;
      if (zoomT.phase === 'in') {
        var k = clamp(zoomT.t / zoomT.dur, 0, 1);
        zoomT.k = zoomT.ease(k);
        if (k >= 1) { zoomT.phase = 'hold'; zoomT.t = 0; }
      } else if (zoomT.phase === 'hold') {
        zoomT.k = 1;
        if (zoomT.t >= zoomT.hold) { zoomT.phase = 'out'; zoomT.t = 0; }
      } else {
        var k2 = clamp(zoomT.t / (zoomT.dur * 1.15), 0, 1);
        zoomT.k = 1 - zoomT.ease(k2);
        if (k2 >= 1) zoomT = null;
      }
    }

    /* 수면 띠 */
    if (band) { band.t += dtRaw; if (band.t >= band.dur) band = null; }

    /* 흔들림 */
    if (shakeT > 0) { shakeT -= dtRaw; if (shakeT <= 0) shakeAmt = 0; }

    updateBubbles(dtRaw * timeScale);
    updateScatter(dtRaw * timeScale);
    updateSand(dtRaw * timeScale);
  }

  /* 렌더가 묻는다 */
  /* 기본 줌(수심 기반)과 연출 목표 줌 사이를 k 로 섞는다.
     연출이 끝나면 k 가 0 으로 돌아가 기본값으로 복귀한다. */
  function zoomOf(baseZoom) {
    if (!zoomT) return baseZoom;
    return lerp(baseZoom, zoomT.to, zoomT.k);
  }
  function focusOf() { return (zoomT && zoomT.focus && zoomT.k > 0.02) ? { p: zoomT.focus, k: zoomT.k } : null; }
  function bandOf()  { return band; }
  function shakeOf() {
    if (shakeT <= 0) return { x:0, y:0 };
    var a = shakeAmt * (shakeT > 0 ? 1 : 0);
    return { x: (Math.random() - 0.5) * a * 2, y: (Math.random() - 0.5) * a * 2 };
  }

  function reset() {
    zoomT = null; band = null; timeScale = 1; tsTarget = 1;
    shakeAmt = 0; shakeT = 0;
    clearBubbles(); clearScatter(); clearSand();
  }

  return {
    EASE: EASE,
    cameraTween: cameraTween, cameraRelease: cameraRelease, cameraHardRelease: cameraHardRelease,
    setTimeScale: setTimeScale, playSurfaceBand: playSurfaceBand, audioSweep: audioSweep,
    shake: shake, play: play, update: update, reset: reset,
    zoomOf: zoomOf, focusOf: focusOf, bandOf: bandOf, shakeOf: shakeOf,
    spawnBubble: spawnBubble, clearBubbles: clearBubbles, bubbles: bubbles,
    spawnScatter: spawnScatter, clearScatter: clearScatter, scatter: scatter,
    spawnSand: spawnSand, clearSand: clearSand, sand: sand,
    get timeScale() { return timeScale; }
  };
})();
