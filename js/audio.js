/* ============================================================
   숨비 (SUMBI) — audio.js

     [절차 생성 앰비언스] ┐
     [base64 SFX]        ├→ BiquadFilter(lowpass, 수심 연동) → Gain → destination
     [BGM (불턱만)]       ┘

   ★ 물속 먹먹함은 정적 음원이 아니라 실시간 필터로 만듭니다.
     수면 8000Hz → 26m 1040Hz.
   ★ 물속에는 BGM 이 없습니다. 심박·기포·먼 저주파만.
   ★ 오디오 자동재생은 정책상 불가하므로 [시작] 버튼 이후에 켭니다.
   ★ 모든 청각 신호에는 시각 대체가 짝지어져 있습니다
     (심박 → 가장자리 펄스 / 숨비소리 → 수면 파문 + 밝기 상승).
   ============================================================ */
var SUMBI = SUMBI || {};

var AUDIO = (function () {

  var ctx = null, ready = false;
  var master, uwFilter, uwGain, sfxGain, bgmGain, heartGain;
  var ambSrc = null, heartTimer = null, bgmTimer = null;
  var curDepthHz = CONFIG.LOWPASS_SURFACE;
  var decoded = {};          /* base64 → AudioBuffer 캐시 */
  var convolver = null;

  function now() { return ctx ? ctx.currentTime : 0; }

  /* ── base64 인라인 디코드 (요청서 14절) ─────────────────
     fetch / XMLHttpRequest 는 file:// 에서 차단되므로
     오디오는 base64 문자열로 js/audio-data.js 에 인라인합니다. */
  function decodeBase64Audio(actx, b64, cb) {
    var bin = atob(b64), buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    actx.decodeAudioData(buf.buffer, cb, function () { /* 실패해도 계속 */ });
  }

  /* ── 노이즈 버퍼 ── */
  function noiseBuffer(sec, brown) {
    var n = Math.floor(ctx.sampleRate * sec);
    var b = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = b.getChannelData(0), last = 0, i;
    for (i = 0; i < n; i++) {
      var w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
      else d[i] = w;
    }
    return b;
  }

  /* 작은 임펄스 응답을 절차적으로 만들어 잔향에 쓴다 (파일 0개) */
  function makeIR(sec, decay) {
    var n = Math.floor(ctx.sampleRate * sec);
    var b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = b.getChannelData(c);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }

  /* ============================================================
     초기화 — 반드시 사용자 제스처(시작 버튼) 안에서 호출
     ============================================================ */
  function init() {
    if (ready) { if (ctx.state === 'suspended') ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;                       /* 오디오가 없어도 게임은 돌아간다 */
    try { ctx = new AC(); } catch (e) { return; }

    master = ctx.createGain();
    master.gain.value = CONFIG.MASTER_VOLUME * SETTINGS.volMaster;
    master.connect(ctx.destination);

    /* 물속 버스 — 수심 연동 로우패스 */
    uwFilter = ctx.createBiquadFilter();
    uwFilter.type = 'lowpass';
    uwFilter.frequency.value = CONFIG.LOWPASS_SURFACE;
    uwFilter.Q.value = 0.4;
    uwGain = ctx.createGain(); uwGain.gain.value = 1;
    uwFilter.connect(uwGain); uwGain.connect(master);

    sfxGain = ctx.createGain(); sfxGain.gain.value = SETTINGS.volSfx;
    sfxGain.connect(uwFilter);

    bgmGain = ctx.createGain(); bgmGain.gain.value = 0;
    bgmGain.connect(master);               /* BGM 은 물속 필터를 타지 않는다 */

    heartGain = ctx.createGain(); heartGain.gain.value = 0;
    heartGain.connect(master);

    convolver = ctx.createConvolver();
    convolver.buffer = makeIR(1.8, 3.2);
    var wet = ctx.createGain(); wet.gain.value = 0.5;
    convolver.connect(wet); wet.connect(uwFilter);

    /* 앰비언스 — 브라운 노이즈 루프 */
    var ab = noiseBuffer(4, true);
    ambSrc = ctx.createBufferSource();
    ambSrc.buffer = ab; ambSrc.loop = true;
    var ag = ctx.createGain(); ag.gain.value = 0.10;
    ambSrc.connect(ag); ag.connect(uwFilter);
    ambSrc.start(0);

    ready = true;
    if (ctx.state === 'suspended') ctx.resume();

    /* base64 SFX 가 있으면 미리 디코드해 둔다 (없으면 절차 생성으로 폴백) */
    if (typeof AUDIO_DATA === 'object') {
      for (var k in AUDIO_DATA) {
        if (!AUDIO_DATA[k]) continue;
        (function (key) {
          decodeBase64Audio(ctx, AUDIO_DATA[key], function (buf) { decoded[key] = buf; });
        })(k);
      }
    }
  }

  function isReady() { return ready; }

  /* ============================================================
     수심 연동 필터
     ============================================================ */
  function setDepth(depthM, maxDepthRef) {
    if (!ready) return;
    var t = Math.max(0, Math.min(1, depthM / (maxDepthRef || CONFIG.VIS_DEPTH_REF)));
    curDepthHz = CONFIG.LOWPASS_SURFACE + (CONFIG.LOWPASS_DEEP - CONFIG.LOWPASS_SURFACE) * t;
    if (!sweeping) uwFilter.frequency.setTargetAtTime(curDepthHz, now(), 0.12);
  }

  /* ── 부품 4. 오디오 스윕 ── */
  var sweeping = false, sweepTimer = null;
  function sweep(cutoffHz, durationSec, masterMul) {
    if (!ready) return;
    var t = now();
    if (cutoffHz !== null && cutoffHz !== undefined) {
      sweeping = true;
      uwFilter.frequency.cancelScheduledValues(t);
      uwFilter.frequency.setValueAtTime(uwFilter.frequency.value, t);
      uwFilter.frequency.exponentialRampToValueAtTime(Math.max(60, cutoffHz), t + durationSec);
      clearTimeout(sweepTimer);
      sweepTimer = setTimeout(function () { sweeping = false; }, durationSec * 1000 + 60);
    }
    if (masterMul !== null && masterMul !== undefined) {
      uwGain.gain.cancelScheduledValues(t);
      uwGain.gain.setTargetAtTime(masterMul, t, durationSec * 0.4);
      setTimeout(function () {
        if (ready) uwGain.gain.setTargetAtTime(1, now(), 0.5);
      }, (durationSec + 1.4) * 1000);
    }
  }

  /* ============================================================
     심박 — 산소가 HEARTBEAT_START_PCT 아래로 내려가면
     ============================================================ */
  var heartLevel = 0;
  function setHeartGain(v) { heartLevel = v; }

  function updateHeart(o2pct) {
    if (!ready) return;
    var lvl = 0;
    if (o2pct < CONFIG.HEARTBEAT_START_PCT) {
      lvl = (CONFIG.HEARTBEAT_START_PCT - o2pct) / CONFIG.HEARTBEAT_START_PCT;
    }
    heartLevel = Math.max(heartLevel * 0.985, lvl);
    heartGain.gain.setTargetAtTime(heartLevel * 0.5, now(), 0.25);

    if (heartLevel > 0.02 && !heartTimer) {
      startHeart();
    } else if (heartLevel <= 0.02 && heartTimer) {
      clearInterval(heartTimer); heartTimer = null;
    }
    if (heartTimer) {
      /* 산소가 없을수록 빨라진다 */
      var bpm = 62 + heartLevel * 58;
      if (Math.abs(bpm - heartBpm) > 5) { clearInterval(heartTimer); heartTimer = null; startHeart(bpm); }
    }
  }

  /* ★ updateHeart() 는 decay(0.985)로만 잦아들기 때문에, 다이빙이 끝나
     더 이상 매 프레임 불리지 않으면 heartTimer 가 마지막 상태 그대로
     영원히 남는다(불턱에서도 두근거림이 계속 들리는 버그의 원인).
     불턱으로 돌아갈 때는 반드시 이 함수로 즉시 끊어야 한다. */
  function stopHeart() {
    if (!ready) return;
    if (heartTimer) { clearInterval(heartTimer); heartTimer = null; }
    heartLevel = 0;
    heartGain.gain.cancelScheduledValues(now());
    heartGain.gain.setTargetAtTime(0, now(), 0.12);
  }

  var heartBpm = 62;
  function startHeart(bpm) {
    heartBpm = bpm || 62;
    var period = 60000 / heartBpm;
    heartTimer = setInterval(function () {
      thump(0); setTimeout(function () { thump(0.28); }, period * 0.26);
    }, period);
  }

  function thump(delay) {
    if (!ready) return;
    var t = now() + (delay || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(64, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(heartGain);
    o.start(t); o.stop(t + 0.26);
  }

  /* ============================================================
     기포 — 짧은 필터 노이즈
     ============================================================ */
  function bubble(strong) {
    if (!ready || SETTINGS.volSfx <= 0) return;
    var t = now();
    var s = ctx.createBufferSource();
    s.buffer = noiseBuffer(0.09, false);
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(700 + Math.random() * 500, t);
    f.frequency.exponentialRampToValueAtTime(1600 + Math.random() * 1400, t + 0.07);
    f.Q.value = 5;
    var g = ctx.createGain();
    g.gain.setValueAtTime((strong ? 0.16 : 0.06) * (0.6 + Math.random() * 0.6), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    s.connect(f); f.connect(g); g.connect(sfxGain);
    s.start(t); s.stop(t + 0.1);
  }

  /* ============================================================
     SFX — base64 가 있으면 그것을, 없으면 절차 생성으로
     ============================================================ */
  function playBuffer(buf, gain) {
    var t = now();
    var s = ctx.createBufferSource(); s.buffer = buf;
    var g = ctx.createGain(); g.gain.value = gain === undefined ? 1 : gain;
    s.connect(g); g.connect(sfxGain);
    s.start(t);
  }

  function tone(freq, dur, type, vol, target, sweepTo) {
    var t = now();
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(target || sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function delayedTone(afterMs, freq, dur, type, vol, target) {
    setTimeout(function () { if (ready) tone(freq, dur, type, vol, target); }, afterMs);
  }

  /* ★ 숨비소리는 이 게임의 로고입니다.
     아래는 임시 절차 생성본입니다. 실제 녹음본을 base64 로 넣으면
     AUDIO_DATA.sumbi 가 자동으로 우선합니다.
     외부 영상·다큐에서 추출하지 마세요. */
  function sumbisori() {
    var t = now();
    /* 1) 날카로운 들숨 휘파람 — 밴드패스 노이즈 상승 */
    var s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.75, false);
    var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 13;
    f.frequency.setValueAtTime(760, t);
    f.frequency.exponentialRampToValueAtTime(2350, t + 0.20);
    f.frequency.exponentialRampToValueAtTime(1180, t + 0.62);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.34);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.72);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + 0.76);
    /* 2) 몸에서 나오는 저음 */
    var o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(560, t);
    o.frequency.exponentialRampToValueAtTime(340, t + 0.55);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.13, t + 0.08);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(og); og.connect(master);
    o.start(t); o.stop(t + 0.64);
  }

  var PROC = {
    sumbi:     sumbisori,
    harvest:   function () { tone(680, 0.13, 'sine', 0.24); delayedTone(60, 1020, 0.10, 'sine', 0.13); },
    bank:      function () { tone(523, 0.18, 'sine', 0.20); delayedTone(90, 784, 0.24, 'sine', 0.17); },
    sell:      function () { tone(587, 0.16, 'triangle', 0.18); delayedTone(110, 784, 0.16, 'triangle', 0.16);
                             delayedTone(230, 1047, 0.34, 'sine', 0.15); },
    upgrade:   function () { tone(392, 0.16, 'triangle', 0.18); delayedTone(100, 523, 0.16, 'triangle', 0.18);
                             delayedTone(210, 659, 0.16, 'triangle', 0.18); delayedTone(320, 784, 0.42, 'sine', 0.20); },
    /* 승급 — 따뜻한 화음 */
    rank:      function () { tone(262, 1.5, 'sine', 0.16); tone(392, 1.5, 'sine', 0.12);
                             tone(523, 1.5, 'sine', 0.10); delayedTone(420, 659, 1.3, 'sine', 0.11); },
    fail:      function () { tone(320, 1.5, 'sine', 0.22, null, 74); },
    /* 첫 조우 — 단음 + 잔향 */
    encounter: function () { tone(880, 0.9, 'sine', 0.20, convolver); tone(880, 0.5, 'sine', 0.10); },
    release:   function () { bubble(true); setTimeout(function () { if (ready) bubble(true); }, 70); },
    ui:        function () { tone(440, 0.06, 'sine', 0.09); },
    /* ── 채집 저항(손맛) ── */
    hv_stage2: function () { tone(340, 0.05, 'triangle', 0.10); },                         /* 버티기 진입 — 낮은 틱 */
    hv_stage3: function () { tone(720, 0.06, 'triangle', 0.13); delayedTone(40, 980, 0.05, 'sine', 0.08); }, /* 마무리 — 밝은 틱 */
    hv_slip:   function () { tone(260, 0.16, 'sawtooth', 0.14, null, 140); },               /* 미끄러짐 — 내려가는 톤 */
    bagpop:    function () { tone(494, 0.07, 'sine', 0.16); delayedTone(50, 659, 0.12, 'sine', 0.14); } /* 망사리 도착 */
  };

  function sfx(name) {
    if (!ready || SETTINGS.volSfx <= 0) return;
    if (decoded[name]) { playBuffer(decoded[name], 1); return; }
    if (PROC[name]) PROC[name]();
  }

  /* ============================================================
     불턱 BGM — 잔잔하게. 물속과 대비되어야 한다.
     ============================================================ */
  var bgmStep = 0;
  var BGM_NOTES = [220, 262, 294, 349, 392, 349, 294, 262];   /* 5음계 */

  function bgm(on) {
    if (!ready) return;
    if (on) {
      bgmGain.gain.setTargetAtTime(SETTINGS.volBgm * 0.34, now(), 0.9);
      if (bgmTimer) return;
      bgmStep = 0;
      bgmTimer = setInterval(function () {
        if (!ready) return;
        var f = BGM_NOTES[bgmStep % BGM_NOTES.length];
        tone(f, 2.2, 'sine', 0.16, bgmGain);
        if (bgmStep % 4 === 0) tone(f / 2, 3.4, 'sine', 0.11, bgmGain);
        bgmStep++;
      }, 1650);
    } else {
      bgmGain.gain.setTargetAtTime(0, now(), 0.5);
      if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
    }
  }

  /* ============================================================
     설정 반영
     ============================================================ */
  function applySettings() {
    if (!ready) return;
    master.gain.setTargetAtTime(CONFIG.MASTER_VOLUME * SETTINGS.volMaster, now(), 0.05);
    sfxGain.gain.setTargetAtTime(SETTINGS.volSfx, now(), 0.05);
    if (bgmTimer) bgmGain.gain.setTargetAtTime(SETTINGS.volBgm * 0.34, now(), 0.2);
  }

  function suspendAmbience(quiet) {
    if (!ready) return;
    uwGain.gain.setTargetAtTime(quiet ? 0 : 1, now(), 0.3);
  }

  return {
    init: init, isReady: isReady,
    setDepth: setDepth, sweep: sweep,
    updateHeart: updateHeart, setHeartGain: setHeartGain, stopHeart: stopHeart,
    bubble: bubble, sfx: sfx, bgm: bgm,
    applySettings: applySettings, suspendAmbience: suspendAmbience,
    decodeBase64Audio: decodeBase64Audio
  };
})();
