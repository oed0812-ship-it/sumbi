/* ============================================================
   숨비 (SUMBI) — render.js
   캔버스 드로잉 + 가시성 3층 + 수면 경계(하늘/굴절) 합성.

   ★ 렌더 순서 (sumbi-lighting-spec.md 1절). 바뀌면 효과가 무너집니다.
      [오프스크린 underCtx]
      1 물 배경 → 2 원경 바위 → 3 빛기둥(additive) → 4 근경/감태/채집물/해녀
      ─ 5 균일 감쇠 → 6 가시거리 마스크 → 7 랜턴 → 8 반짝임
      ─ 9 채도 소실 → 10 전체 감광 → 11 비네트
      [메인 캔버스]
      12 하늘/먼바다(근수면선 위) → 13 오프스크린 클립+굴절 합성
      ─ 14 수면선(포말+발광) → 15 동료 해녀 → 16 수면 힌트 띠

   ★ 반짝임은 안개보다 위, 산소보다 아래.
     안개는 뚫고 보이되 숨이 없으면 반짝임도 사라져야 합니다.

   ★ 매 프레임 createGradient 를 부르지 않습니다. 오프스크린에 굽고 재사용.
   ★ getImageData 를 쓰지 않습니다 (file:// 캔버스는 tainted).
     심해 색 소실은 픽셀 조작이 아니라 값 계산 + 오버레이입니다.
   ============================================================ */
var SUMBI = SUMBI || {};

var RENDER = (function () {

  var cv, ctx, DPR = 1;
  var W = CONFIG.VIEW_W, H = CONFIG.VIEW_H;
  var T = 0;   /* 렌더 시간 (초). 흔들림·맥동용 */

  /* 동료 해녀의 "한 번 바라봄" — 살림 자리가 hidden→hinted 로 넘어가는 순간에만 쓴다.
     팝업도 대사도 없이, 시선만 잠깐 그쪽으로 돌아간다(0.8초). 저장 대상 아님(순수 연출). */
  var GLANCE_DUR = 0.8;
  var glance = { t: 0, x: 0, y: 0 };
  function triggerAllyGlance(targetX, targetY) { glance.t = GLANCE_DUR; glance.x = targetX; glance.y = targetY; }
  /* 살림 발견 대사를 띄우는 기준 위치 — 화덕 앞 동료 해녀 머리 위 (bulteok 전용 좌표) */
  function allyHeadPos() { return { x: 175, y: 401 }; }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
  function mixC(a, b, t) {
    return [Math.round(lerp(a[0],b[0],t)), Math.round(lerp(a[1],b[1],t)), Math.round(lerp(a[2],b[2],t))];
  }
  function grayOf(c) { return Math.round(c[0]*0.3 + c[1]*0.59 + c[2]*0.11); }

  /* ── 색 ── */
  var COL = {
    skyTop:[0,134,184], skyLow:[208,250,251],
    waterTop:[111,216,246], waterDeep:[0,24,58],
    fog:[26,74,104],
    rock:[18,38,48],
    kelp:[20,50,42],
    sand:[58,72,74],
    diver:[10,20,26],
    tewak:[255,255,255],
    ally:[16,28,36],
    fire:[255,168,72],
    /* 근수면선 — 포말(파도 위 흰 줄) · 표층 발광(수면 바로 아래를 밝히는 띠) */
    foam:[255,255,255], foamGlow:[206,236,246], subsurfGlow:[147,225,246]
  };

  /* ★ saturation 블렌드 기능 감지.
     미지원 브라우저에서 이 대입은 조용히 실패하고 source-over 가 유지되므로
     회색이 화면 전체를 그대로 덮는 사고가 납니다. 반드시 감지 후 사용. */
  var SUPPORTS_SAT = (function () {
    var t = document.createElement('canvas').getContext('2d');
    t.globalCompositeOperation = 'saturation';
    return t.globalCompositeOperation === 'saturation';
  })();


  /* ============================================================
     스프라이트 로드 — 실패하면 도형으로 자동 폴백
     아트 작업과 코드 작업을 병렬로 진행하기 위함입니다.
     ============================================================ */
  var SPRITES = {};
  /* ★ 해녀/관찰 3종은 "관절" 단위로 쪼갠 조각 스프라이트입니다.
     각 조각의 피벗(회전/이동 기준점)은 drawDiver / drawObserverShape 안의
     *_JOINT 상수에 로컬 좌표(캐릭터 h·w 비율)로 문서화되어 있습니다.
     하나라도 없으면 그 조각만 기존 벡터 도형으로 자동 폴백됩니다. */
  var SPRITE_LIST = [
    'hae_torso','hae_arm','hae_fin','hae_bag','hae_head','hae_leg',
    'cr_bomal','cr_miyeok','cr_sora','cr_seonggae','cr_haesam','cr_obunjagi',
    'cr_munuh','cr_jeonbok','cr_dolge',
    'ob_dolphin_body','ob_dolphin_tail','ob_turtle_body','ob_turtle_flipper',
    'ob_ray_hub','ob_ray_wing',
    'gamtae',
    'rock_0','rock_1','rock_2','rock_3','rock_4',
    'bg_sky','bg_far','bg_near','tewak','bulteok',
    'home_house','home_field','home_diver'
  ];
  var spritesPending = 0;

  function preload(done) {
    spritesPending = SPRITE_LIST.length;
    if (spritesPending === 0) { done(); return; }
    var finished = false;
    function tick() {
      spritesPending--;
      if (spritesPending <= 0 && !finished) { finished = true; done(); }
    }
    for (var i = 0; i < SPRITE_LIST.length; i++) {
      (function (key) {
        var img = new Image();
        img.onload = function () { SPRITES[key] = img; tick(); };
        img.onerror = function () {
          /* png 가 없으면 svg 로 재시도 — 관절 조각은 svg 로 배포됩니다 */
          var svg = new Image();
          svg.onload  = function () { SPRITES[key] = svg; tick(); };
          svg.onerror = function () { SPRITES[key] = null; tick(); };   /* 둘 다 없으면 도형으로 그림 */
          svg.src = './assets/img/' + key + '.svg';
        };
        img.src = './assets/img/' + key + '.png';
      })(SPRITE_LIST[i]);
    }
    /* 안전장치 — 무슨 일이 있어도 2초 뒤에는 시작한다 */
    setTimeout(function () { if (!finished) { finished = true; done(); } }, 2000);
  }

  /* 흰색 실루엣에 색을 입힌다. getImageData 불필요. ★ 반드시 캐시 */
  var tintCache = {};
  function tint(key, color) {
    var ck = key + '|' + color;
    if (tintCache[ck]) return tintCache[ck];
    var src = SPRITES[key];
    if (!src) return null;
    var c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    var g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    tintCache[ck] = c;
    return c;
  }


  /* ============================================================
     스프라이트 캐시 — 실행 중 비용은 drawImage 뿐
     ============================================================ */

  /* 안개 마스크 — 반경이 크게 바뀔 때만 다시 굽는다 */
  var fogCache = null, fogKey = '';
  function getFogSprite(radius, softness, alpha) {
    var R = Math.max(8, Math.min(1200, Math.round(radius / 16) * 16));
    var key = R + '|' + softness.toFixed(2) + '|' + alpha.toFixed(2);
    if (fogCache && fogKey === key) return fogCache;
    var c = document.createElement('canvas');
    c.width = c.height = R * 2;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(R, R, R * softness, R, R, R);
    grd.addColorStop(0, rgba(COL.fog, 0));
    grd.addColorStop(0.72, rgba(COL.fog, alpha * 0.55));
    grd.addColorStop(1, rgba(COL.fog, alpha));
    g.fillStyle = grd;
    g.fillRect(0, 0, R * 2, R * 2);
    fogCache = c; fogKey = key;
    return c;
  }

  /* 빛기둥 — Canvas 그라디언트는 축이 하나뿐이라 길이+폭을 한 번에 흐릴 수 없다.
     사다리꼴을 폭만 조금씩 줄여가며 16번 겹쳐 칠해 폭 방향 falloff 를 만든다.
     ★ 굽는 단계이므로 비용 걱정 없이 복잡하게 넣어도 된다.
       실행 중 비용은 여전히 drawImage 1회. */
  var shaftSprite = null, shaftKey = '';
  function getShaftSprite() {
    var key = [CONFIG.LIGHT_SHAFT_WIDTH_SHALLOW, CONFIG.LIGHT_SHAFT_WIDTH_DEEP,
               CONFIG.LIGHT_SHAFT_EDGE_SOFT].join('|');
    if (shaftSprite && shaftKey === key) return shaftSprite;

    var wT = Math.max(2, CONFIG.LIGHT_SHAFT_WIDTH_SHALLOW);
    var wB = Math.max(0, CONFIG.LIGHT_SHAFT_WIDTH_DEEP);
    var SW = Math.ceil(wT) + 10, SH = 512;
    var c = document.createElement('canvas');
    c.width = SW; c.height = SH;
    var g = c.getContext('2d');

    var vg = g.createLinearGradient(0, 0, 0, SH);
    vg.addColorStop(0.00, 'rgba(200,238,255,1)');
    vg.addColorStop(0.45, 'rgba(170,220,252,0.50)');
    vg.addColorStop(1.00, 'rgba(140,195,235,0)');
    g.fillStyle = vg;
    g.globalCompositeOperation = 'lighter';

    var N = 16, cx = SW / 2, i;
    for (i = 0; i < N; i++) {
      var f = 1 - (i / N) * CONFIG.LIGHT_SHAFT_EDGE_SOFT;
      var tw = wT * f * 0.5, bw = wB * f * 0.5;
      g.globalAlpha = 1 / N;
      g.beginPath();
      g.moveTo(cx - tw, 0); g.lineTo(cx + tw, 0);
      g.lineTo(cx + bw, SH); g.lineTo(cx - bw, SH);
      g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
    shaftSprite = c; shaftKey = key;
    return c;
  }

  /* 빛기둥 1개의 흔들림(sway)·숨쉬기(breath)·기울기(angle) —
     원본 렌더 루프와 수면 패치(drawShaftSurfaceBlend) 양쪽이 똑같이 써서
     둘의 모양이 어긋나지 않게 한다. */
  function shaftMotion(sh) {
    var sw = Math.sin(T * sh.sp + sh.ph) * CONFIG.LIGHT_SHAFT_SWAY;
    var breath = 1 + Math.sin(T * sh.sp * 1.6 + sh.ph * 2.1) * 0.12 * CONFIG.LIGHT_SHAFT_SWAY;
    var angle = Math.atan(sh.tilt) + sw * 0.10;
    return { sw: sw, breath: breath, angle: angle };
  }

  /* ★ 빛기둥은 세계좌표 y=0(평평한 기준 수면)에서 시작해 오프스크린에
     그려진 뒤, compositeUnderwater() 가 "물결선" 을 따라 하드 클립한다.
     물결은 기준 수면 위아래로 진동하므로(WAVE_AMP), 물결이 골로 내려온
     구간에서는 빛기둥의 가장 밝은 윗부분이 그대로 잘려 마치 잘린 것처럼
     보인다. 해녀와 동일한 해법 — 물결선 기준 그라디언트로 알파를 마스킹한
     사본을 클립 밖(수면 근처)에 겹쳐 그려 이어붙인다.
     ★ 처음엔 피벗 한 점의 기울기만으로 그라디언트 하나를 통째로 기울여
     썼는데, 캔버스가 회전 대비로 넓다 보니(물결 반파장에 맞먹는 폭) 물결이
     실제로는 곡선인데 그 폭 전체를 직선 하나로 근사해버려 — 그 "근사선"
     자체가 눈에 띄는 직선 절단면으로 보였다. 그래서 이제는 열(column) 마다
     그 x 의 실제 물결선(waveScreenY)을 다시 구해 세로 그라디언트를 따로
     세운다 — compositeUnderwater()/buildWavePoints() 가 물결을 그릴 때 쓰는
     것과 같은 샘플링 방식이라, 물결이 아무리 굽어 있어도 마스크 경계가
     그 굽이를 그대로 따라간다. */
  var shaftGhostCv = null, shaftGhostCtx = null;
  function ensureShaftGhostCanvas(w, h) {
    if (!shaftGhostCv) { shaftGhostCv = document.createElement('canvas'); shaftGhostCtx = shaftGhostCv.getContext('2d'); }
    if (shaftGhostCv.width !== w || shaftGhostCv.height !== h) { shaftGhostCv.width = w; shaftGhostCv.height = h; }
  }
  function drawShaftSurfaceBlend(cam, G, B, surf, q) {
    var shaftN = q === 0 ? 0 : (q === 1 ? Math.min(1, G.shafts.length) : G.shafts.length);
    if (shaftN <= 0) return;
    var spr = getShaftSprite();
    var feather = 46 * cam.zoom;
    var capWorldH = 150;                    /* 물결 진폭+페더를 덮는 캡 길이(월드 단위) */
    /* ★ 캔버스는 회전된 캡 전체가 어느 각도로 돌아도 잘리지 않도록,
       피벗에서 캡의 가장 먼 모서리까지 거리(대각선)를 반지름으로 잡는다. */
    var breathMax = 1 + 0.12 * CONFIG.LIGHT_SHAFT_SWAY;
    var halfW = spr.width * 0.5 * breathMax;
    var R = Math.ceil((Math.sqrt(halfW * halfW + capWorldH * capWorldH) + 20) * cam.zoom);
    var cw = R * 2, ch = R * 2;
    ensureShaftGhostCanvas(cw, ch);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = B.shaftAlpha;
    for (var i = 0; i < shaftN; i++) {
      var sh = G.shafts[i];
      var m = shaftMotion(sh);
      var wx = sh.x + m.sw * 26;
      var sp = w2s(cam, wx, 0);              /* 빛기둥 상단 = 항상 평평한 기준 수면(surf) */
      if (sp.x < -R || sp.x > W + R) continue;
      var waveY = waveScreenY(cam, surf, sp.x);

      shaftGhostCtx.setTransform(1, 0, 0, 1, 0, 0);
      shaftGhostCtx.clearRect(0, 0, cw, ch);
      shaftGhostCtx.save();
      shaftGhostCtx.translate(R, R);
      shaftGhostCtx.rotate(m.angle);
      shaftGhostCtx.scale(m.breath * cam.zoom, cam.zoom);
      shaftGhostCtx.drawImage(spr, -spr.width / 2, 0, spr.width, capWorldH);
      shaftGhostCtx.restore();

      /* 열(column)마다 그 x 의 실제 물결선을 다시 구해 세로 그라디언트를
         세운다 — 물결 위(피벗 쪽)는 그대로, 물결 아래로 FEATHER 만큼
         서서히 사라진다. 캔버스 자체는 회전하지 않았으므로(내용만 회전해
         그렸다) 이 좌표는 화면 좌표와 그대로 대응한다. */
      shaftGhostCtx.globalCompositeOperation = 'destination-in';
      var colStep = 8;
      for (var lx = 0; lx <= cw; lx += colStep) {
        var colWaveY = waveScreenY(cam, surf, sp.x - R + lx);
        var colLocalWaveY = R + (colWaveY - sp.y);
        var grad = shaftGhostCtx.createLinearGradient(0, colLocalWaveY, 0, colLocalWaveY + feather);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        shaftGhostCtx.fillStyle = grad;
        shaftGhostCtx.fillRect(lx, 0, colStep + 1, ch);
      }
      shaftGhostCtx.globalCompositeOperation = 'source-over';

      ctx.drawImage(shaftGhostCv, sp.x - R, sp.y - R);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  /* 반짝임 — 최초 1회만 */
  var glintSprite = null;
  function getGlintSprite() {
    if (glintSprite) return glintSprite;
    var R = 64;
    var c = document.createElement('canvas');
    c.width = c.height = R * 2;
    var g = c.getContext('2d');
    var gr = g.createRadialGradient(R, R, 0, R, R, R);
    gr.addColorStop(0.00, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.18, 'rgba(214,242,255,0.42)');
    gr.addColorStop(0.55, 'rgba(150,205,255,0.12)');
    gr.addColorStop(1.00, 'rgba(120,180,240,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, R * 2, R * 2);
    glintSprite = c;
    return c;
  }

  var vigSprite = null;
  function getVignetteSprite() {
    if (vigSprite) return vigSprite;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(W/2, H/2, Math.min(W,H)*0.30, W/2, H/2, Math.max(W,H)*0.72);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.6, 'rgba(0,0,0,0.45)');
    grd.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    vigSprite = c;
    return c;
  }


  /* ============================================================
     좌표
     ============================================================ */
  function depthRatio(yPx) {
    /* ★ 절대 수심 기준. 스테이지 최대 수심으로 나누면
       12m 스테이지의 바닥이 26m 스테이지의 바닥만큼 캄캄해진다. */
    return clamp(yPx / (CONFIG.VIS_DEPTH_REF * CONFIG.PIXELS_PER_METER), 0, 1);
  }

  function w2s(cam, wx, wy) {
    return { x: (wx - cam.cx) * cam.zoom + W/2 + cam.sx,
             y: (wy - cam.cy) * cam.zoom + H/2 + cam.sy };
  }

  /* ★ 바위는 지금까지 바당당 색 하나(B.rockCol)를 화면 전체에 그대로 썼습니다.
     수심에 따른 감쇠(가시성 3층)는 "지금 해녀가 있는 수심" 기준 화면 전체
     보정이라, 한 화면 안에 얕은 바위와 깊은 바위가 같이 보이면 밝기 차이가
     드러나지 않았습니다. 여기서는 바위 개별 y(수심)로 물 배경과 같은 방식
     (mixC + depthRatio)으로 세로 방향 밝기 그라데이션을 만듭니다 —
     수면 쪽은 흰색 쪽으로, 심해 쪽은 COL.waterDeep 쪽으로 블렌드.
     B.rockCol 은 그대로 "기준색"으로 남아 색상 자체는 디버그 패널에서 바꿀 수 있고,
     밝기만 수심에 따라 자동으로 갈립니다. */
  var ROCK_LIGHT_MIX = 0.30, ROCK_DARK_MIX = 0.62;
  function rockColorAt(B, yPx) {
    var d = depthRatio(yPx);
    var light = mixC(B.rockCol, [255, 255, 255], ROCK_LIGHT_MIX);
    var dark = mixC(B.rockCol, COL.waterDeep, ROCK_DARK_MIX);
    return mixC(light, dark, d);
  }

  /* 바위 실루엣 — 매끈한 타원이 아니라 현무암처럼 울퉁불퉁한 덩어리(단,
     너무 각지지 않도록 꼭짓점은 둥글려 이어준다). seed 로 결정적이라
     매 프레임 흔들리지 않는다.
     ★ 각 점을 직선(lineTo)으로 잇는 대신, 점과 점 사이 중점을 향해
     2차 베지어로 이어서 꼭짓점을 살짝 깎는다 — 울퉁불퉁한 개성은
     그대로 두고 "각짐"만 완화하는 표준적인 방법이다. 노이즈 진폭도
     0.26 → 0.20 으로 살짝 낮춰 전체적으로 조금 더 둥글게 했다. */
  function rockPath(g, o, scale) {
    var N = 9, R = o.r * (scale || 1);
    var pts = [];
    for (var i = 0; i <= N; i++) {
      var a = Math.PI + (i / N) * Math.PI;              /* 위쪽 반원만 솟는다 */
      var n = Math.sin(o.seed + i * 2.13) * 0.5 + Math.sin(o.seed * 1.7 + i * 4.7) * 0.22;
      var rr = R * (0.80 + n * 0.20);
      pts.push({ x: o.x + Math.cos(a + o.rot) * rr, y: o.y + Math.sin(a + o.rot) * rr * 0.66 });
    }
    pts.push({ x: o.x + R * 1.02, y: o.y + R * 0.30 });
    pts.push({ x: o.x - R * 1.02, y: o.y + R * 0.30 });

    function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
    var m0 = mid(pts[pts.length - 1], pts[0]);
    g.beginPath();
    g.moveTo(m0.x, m0.y);
    for (var j = 0; j < pts.length; j++) {
      var nextPt = pts[(j + 1) % pts.length];
      var m = mid(pts[j], nextPt);
      g.quadraticCurveTo(pts[j].x, pts[j].y, m.x, m.y);
    }
    g.closePath();
  }

  /* ★ 개별(떨어져 있는) 바위 전용 채색 — 위쪽은 그 바위의 원래 불투명도
     그대로(=100%), 아래쪽은 0%(완전 투명)까지 세로로 자연스럽게 빠지는
     그라데이션. 화면 전체를 덮는 바다 밑바닥(해저) 폴리곤과 채집물을
     가리는 합성 바위(coverRock, 의도적으로 계속 불투명해야 함)에는
     쓰지 않는다 — 이 두 곳은 rockPath 를 그대로 solid fill 로 쓴다. */
  function rockFillGradient(o, R, baseAlpha, color) {
    var g = ctx.createLinearGradient(o.x, o.y - R, o.x, o.y + R * 0.30);
    g.addColorStop(0, rgba(color, baseAlpha));
    g.addColorStop(1, rgba(color, 0));
    return g;
  }


  /* ============================================================
     초기화
     ============================================================ */
  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d', { alpha: false });
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);   /* 상한 2 */
    if (SETTINGS.quality === 0) DPR = Math.min(DPR, 1);
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    vigSprite = null;
  }


  /* ============================================================
     채집 생물 섬네일 — assets/img/cr_<id>.png 가 있으면 그걸 쓰고,
     없거나 로드 실패하면 drawCritterShape() 도형으로 자동 폴백합니다.
     ★ 원본 PNG(512×512)는 종마다 여백이 제각각이라, 실제 내용 bbox 로
       잘라서 그려야 종 간 화면 크기가 고르게 나옵니다(sips/PIL 로 측정한 값).
     ============================================================ */
  var CR_SPRITE_BBOX = {
    bomal:    [109, 100, 291, 315],
    miyeok:   [123,  56, 297, 421],
    sora:     [ 74,  95, 359, 340],
    seonggae: [ 68,  98, 354, 319],
    haesam:   [ 41, 167, 444, 172],
    obunjagi: [ 96,  86, 310, 324],
    munuh:    [ 21,  63, 468, 380],
    jeonbok:  [ 67, 100, 383, 308],
    dolge:    [ 15, 126, 477, 291]
  };
  function drawCritter(g, sp, r, col) {
    var spr = SPRITES['cr_' + sp.id];
    var bb = spr && CR_SPRITE_BBOX[sp.id];
    if (!bb) { drawCritterShape(g, sp, r, col); return; }
    var dh = r * 2.7, dw = dh * (bb[2] / bb[3]);
    g.drawImage(spr, bb[0], bb[1], bb[2], bb[3], -dw / 2, -dh / 2, dw, dh);
  }

  /* ★ locked(도감 미획득) 실루엣 — 스포일러 방지를 위해 텍스처는 감추되,
     실제 원본 PNG와 같은 모양이어야 한다. tint()로 원본의 알파(윤곽)만
     남기고 단색을 입혀서 그린다 (관찰 3종의 drawObserverShape 와 동일 원리).
     원본이 없을 때만 손그림 도형(drawCritterShape)으로 폴백한다. */
  function drawCritterLocked(g, sp, r, col) {
    var bb = CR_SPRITE_BBOX[sp.id];
    var img = bb && tint('cr_' + sp.id, rgb(col));
    if (!img) { drawCritterShape(g, sp, r, col); return; }
    var dh = r * 2.7, dw = dh * (bb[2] / bb[3]);
    g.drawImage(img, bb[0], bb[1], bb[2], bb[3], -dw / 2, -dh / 2, dw, dh);
  }

  /* ============================================================
     생물 도형 폴백 — 스프라이트가 없어도 12종이 구분되어야 한다.
     색약 대응: 색뿐 아니라 실루엣 형태로도 구분합니다.
     ============================================================ */
  function drawCritterShape(g, sp, r, col) {
    g.fillStyle = rgb(col);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    var i, a;
    switch (sp.id) {
      case 'bomal':     /* 작은 고둥 — 나선 */
        g.beginPath(); g.arc(0, 0, r, 0, 6.2832); g.fill();
        g.beginPath();
        for (i = 0; i <= 26; i++) { a = i/26*5.6; var rr = r*(1-i/34);
          g[i?'lineTo':'moveTo'](Math.cos(a)*rr*0.8, Math.sin(a)*rr*0.8); }
        g.stroke();
        break;
      case 'miyeok':    /* 미역 — 잎사귀 */
        g.beginPath();
        g.moveTo(0, r*1.5);
        g.quadraticCurveTo(-r*1.3, r*0.1, -r*0.25, -r*1.5);
        g.quadraticCurveTo(r*0.25, r*0.1, r*1.1, r*0.2);
        g.quadraticCurveTo(r*0.3, r*0.9, 0, r*1.5);
        g.fill();
        break;
      case 'sora':      /* 뿔소라 — 뿔 있는 원뿔 */
        g.beginPath(); g.moveTo(0, -r*1.25);
        g.lineTo(r*0.95, r*0.75); g.lineTo(-r*0.95, r*0.75); g.closePath(); g.fill();
        for (i = 0; i < 5; i++) { a = -1.9 + i*0.95;
          g.beginPath(); g.moveTo(Math.cos(a)*r*0.55, Math.sin(a)*r*0.4 - r*0.1);
          g.lineTo(Math.cos(a)*r*1.15, Math.sin(a)*r*0.85 - r*0.1); g.stroke(); }
        break;
      case 'seonggae':  /* 성게 — 가시 */
        for (i = 0; i < 14; i++) { a = i/14*6.2832;
          g.beginPath(); g.moveTo(0,0); g.lineTo(Math.cos(a)*r*1.65, Math.sin(a)*r*1.65);
          g.strokeStyle = rgb(col); g.lineWidth = 1.7; g.stroke(); }
        g.beginPath(); g.arc(0,0,r*0.8,0,6.2832); g.fill();
        break;
      case 'haesam':    /* 해삼 — 돌기 있는 타원 */
        g.beginPath(); g.ellipse(0,0,r*1.35,r*0.62,0,0,6.2832); g.fill();
        for (i = 0; i < 7; i++) { var px = -r*1.1 + i*(r*0.37);
          g.beginPath(); g.moveTo(px, -r*0.4); g.lineTo(px, -r*0.85);
          g.strokeStyle = rgb(col); g.lineWidth = 2; g.stroke(); }
        break;
      case 'obunjagi': case 'jeonbok':  /* 전복류 — 구멍 줄 있는 타원 껍데기 */
        g.beginPath(); g.ellipse(0,0,r*1.25,r*0.82,-0.25,0,6.2832); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.30)';
        for (i = 0; i < 4; i++) {
          g.beginPath(); g.arc(-r*0.45 + i*r*0.36, -r*0.30 + i*r*0.07, r*0.10, 0, 6.2832); g.stroke();
        }
        break;
      case 'munuh':     /* 문어 — 머리 + 다리 */
        g.beginPath(); g.ellipse(0,-r*0.32,r*0.78,r*0.68,0,0,6.2832); g.fill();
        for (i = 0; i < 6; i++) {
          a = -2.6 + i*0.52;
          g.beginPath(); g.moveTo(0, r*0.15);
          g.quadraticCurveTo(Math.cos(a)*r*1.0, r*0.85, Math.cos(a)*r*1.5, r*0.45 + Math.sin(i*1.7)*r*0.4);
          g.strokeStyle = rgb(col); g.lineWidth = r*0.24; g.lineCap = 'round'; g.stroke();
        }
        break;
      case 'dolge':     /* 돌게 — 옆으로 뻗은 다리 + 집게 */
        g.beginPath(); g.ellipse(0, 0, r*1.15, r*0.72, 0, 0, 6.2832); g.fill();
        g.strokeStyle = rgb(col); g.lineWidth = r*0.16; g.lineCap = 'round';
        for (i = 0; i < 3; i++) {
          a = -0.5 + i*0.4;
          g.beginPath(); g.moveTo(-Math.cos(a)*r*0.9, Math.sin(a)*r*0.5);
          g.lineTo(-Math.cos(a)*r*1.7, Math.sin(a)*r*1.1 + r*0.3);
          g.stroke();
          g.beginPath(); g.moveTo(Math.cos(a)*r*0.9, Math.sin(a)*r*0.5);
          g.lineTo(Math.cos(a)*r*1.7, Math.sin(a)*r*1.1 + r*0.3);
          g.stroke();
        }
        g.fillStyle = rgb(col);
        g.beginPath(); g.ellipse(-r*1.05, -r*0.15, r*0.32, r*0.22, 0.5, 0, 6.2832); g.fill();
        g.beginPath(); g.ellipse(r*1.05, -r*0.15, r*0.32, r*0.22, -0.5, 0, 6.2832); g.fill();
        break;
      default:
        g.beginPath(); g.arc(0,0,r,0,6.2832); g.fill(); g.stroke();
    }
  }

  /* ============================================================
     관찰 3종 — 관절(피벗) 정의
     ★ 아트 교체용 관절 조각 — assets/img/ob_*.svg (또는 .png)
       좌표는 sp.w/sp.h(도감 기준 크기) 비율입니다. 오른쪽을 향한
       기준 자세로 그리세요(좌우반전은 코드가 처리). 흰색 실루엣이면
       RENDER.tint() 가 종별 색을 자동으로 입힙니다.
         돌고래 — ob_dolphin_body(몸통+등지느러미, 원점 기준, 정지 자세)
                  ob_dolphin_tail(꼬리, DOLPHIN_TAIL 피벗 기준, 살짝 흔들림)
         거북  — ob_turtle_body(등딱지+머리+꼬리, 원점 기준, 고정)
                  ob_turtle_flipper(앞지느러미 1장을 위/아래 관절에 재사용)
         쥐가오리 — ob_ray_hub(몸통 중심+코+꼬리, 원점 기준, 고정)
                    ob_ray_wing(날개 1장을 위/아래 관절에 재사용, 파닥임)
       조각이 없으면 그 부분만 기존 벡터 도형으로 자동 폴백됩니다.
     ============================================================ */
  var DOLPHIN_BODY_BOX = { x: -0.24, y: -0.78, w: 0.76, h: 1.18 };  /* 원점 기준 */
  var DOLPHIN_TAIL      = { x: -0.20, y: -0.03 };                    /* 꼬리 피벗 */
  var DOLPHIN_TAIL_BOX = { x: -0.32, y: -0.42, w: 0.38, h: 0.84 };  /* 꼬리 피벗 기준 */

  var TURTLE_BODY_BOX    = { x: -0.50, y: -0.46, w: 1.10, h: 0.96 }; /* 원점 기준 */
  var TURTLE_FLIP_BOT    = { x: 0.16, y:  0.28 };
  var TURTLE_FLIP_BOX    = { x: -0.06, y: -0.12, w: 0.54, h: 0.24 }; /* 각 피벗 기준 */

  var RAY_HUB_BOX  = { x: -0.64, y: -0.20, w: 1.10, h: 0.40 };  /* 원점 기준 */
  var RAY_WING_BOX = { x: -0.50, y: -0.40, w: 0.82, h: 0.42 };  /* 원점(어깨) 기준, 위쪽 날개 자세 */

  /* 관찰 3종 도형
     ★ 원본 텍스처 우선 — locked(도감 미획득, 스포일러 방지)일 때만 tint()로
       단색 실루엣을 만든다. 그 외(실제 조우·도감 상세)에는 원본 스프라이트를
       그대로 그리므로, 수심에 따른 색상 손실(applyColorLoss)은 이 3종에는
       더 이상 적용되지 않는다 — 텍스처를 살리는 쪽을 택한 결과다. */
  function drawObserverShape(g, sp, s, col, t, locked) {
    var w = sp.w * s, h = sp.h * s;
    var c = rgb(col);
    g.fillStyle = c;
    function art(key) { return locked ? tint(key, c) : SPRITES[key]; }
    if (sp.id === 'dolphin') {
      var tailImg = art('ob_dolphin_tail');
      var bodyImg = art('ob_dolphin_body');
      var wag = Math.sin(t * 1.6) * 0.16;   /* 살짝 흔드는 꼬리 관절 */
      g.save();
      g.translate(DOLPHIN_TAIL.x*w, DOLPHIN_TAIL.y*h);
      g.rotate(wag);
      if (tailImg) {
        g.drawImage(tailImg, DOLPHIN_TAIL_BOX.x*w, DOLPHIN_TAIL_BOX.y*h, DOLPHIN_TAIL_BOX.w*w, DOLPHIN_TAIL_BOX.h*h);
      } else {
        g.beginPath();
        g.moveTo(w*0.22, -h*0.05);
        g.quadraticCurveTo(w*0.02, -h*0.18, -w*0.22, -h*0.34);
        g.lineTo(-w*0.16, 0);
        g.lineTo(-w*0.22, h*0.32);
        g.quadraticCurveTo(w*0.02, h*0.16, w*0.22, h*0.05);
        g.closePath(); g.fill();
      }
      g.restore();
      if (bodyImg) {
        g.drawImage(bodyImg, DOLPHIN_BODY_BOX.x*w, DOLPHIN_BODY_BOX.y*h, DOLPHIN_BODY_BOX.w*w, DOLPHIN_BODY_BOX.h*h);
      } else {
        g.beginPath();
        g.moveTo(w*0.5, 0);
        g.quadraticCurveTo(w*0.1, -h*0.44, -w*0.20, -h*0.14);
        g.lineTo(-w*0.10, h*0.10);
        g.quadraticCurveTo(w*0.2, h*0.30, w*0.5, 0);
        g.fill();
        g.beginPath();                                            /* 등지느러미 */
        g.moveTo(-w*0.02, -h*0.30); g.lineTo(w*0.10, -h*0.72); g.lineTo(w*0.16, -h*0.26);
        g.fill();
      }
    } else if (sp.id === 'turtle') {
      var bodyI = art('ob_turtle_body');
      var flipI = art('ob_turtle_flipper');
      var fl = Math.sin(t * 1.4) * 0.35;
      if (bodyI) {
        g.drawImage(bodyI, TURTLE_BODY_BOX.x*w, TURTLE_BODY_BOX.y*h, TURTLE_BODY_BOX.w*w, TURTLE_BODY_BOX.h*h);
      } else {
        g.beginPath(); g.ellipse(0, 0, w*0.34, h*0.42, 0, 0, 6.2832); g.fill();
        g.beginPath(); g.ellipse(w*0.44, -h*0.06, w*0.12, h*0.15, 0, 0, 6.2832); g.fill();
        g.beginPath(); g.ellipse(-w*0.30, h*0.18, w*0.16, h*0.07, 0.5, 0, 6.2832); g.fill();
      }
      /* 앞지느러미 — 한 장만 그린다(예전엔 위/아래 두 장이었다) */
      g.save(); g.translate(TURTLE_FLIP_BOT.x*w, TURTLE_FLIP_BOT.y*h); g.rotate(0.5 - fl);
      if (flipI) g.drawImage(flipI, TURTLE_FLIP_BOX.x*w, TURTLE_FLIP_BOX.y*h, TURTLE_FLIP_BOX.w*w, TURTLE_FLIP_BOX.h*h);
      else { g.beginPath(); g.ellipse(w*0.2, 0, w*0.24, h*0.09, 0, 0, 6.2832); g.fill(); }
      g.restore();
    } else {   /* ray — 쥐가오리 */
      var hubI = art('ob_ray_hub');
      var wingI = art('ob_ray_wing');
      var flapAng = Math.sin(t * 1.15) * 0.22;
      /* 날개 — 한 장만 그린다(예전엔 위/아래 두 장이었다) */
      g.save(); g.rotate(flapAng);
      if (wingI) g.drawImage(wingI, RAY_WING_BOX.x*w, RAY_WING_BOX.y*h, RAY_WING_BOX.w*w, RAY_WING_BOX.h*h);
      else {
        var flap = Math.sin(t * 1.15) * h * 0.30;
        g.beginPath();
        g.moveTo(w*0.30, 0);
        g.quadraticCurveTo(w*0.02, -h*0.34, -w*0.46, -h*0.16 - flap);
        g.quadraticCurveTo(-w*0.16, 0, w*0.30, 0);
        g.fill();
      }
      g.restore();
      if (hubI) {
        g.drawImage(hubI, RAY_HUB_BOX.x*w, RAY_HUB_BOX.y*h, RAY_HUB_BOX.w*w, RAY_HUB_BOX.h*h);
      } else {
        g.beginPath(); g.moveTo(-w*0.30, 0);
        g.quadraticCurveTo(-w*0.46, h*0.06, -w*0.60, h*0.02);
        g.strokeStyle = c; g.lineWidth = h*0.05; g.stroke();
        g.beginPath(); g.moveTo(w*0.30, -h*0.10); g.lineTo(w*0.44, -h*0.18);
        g.lineTo(w*0.40, 0); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(w*0.30, h*0.10); g.lineTo(w*0.44, h*0.18);
        g.lineTo(w*0.40, 0); g.closePath(); g.fill();
      }
    }
  }


  /* ============================================================
     해녀 — 관절(피벗) 정의
     ★ 기울기로 산소를 표현하지 않습니다 (몸이 진행 방향으로 회전하므로).
       웅크림(curl) 곡률 · 발차기 진폭/빈도 · 기포 간격으로만.

     ★ 아트 교체용 관절 6조각 — assets/img/hae_*.svg (또는 .png)
       각 좌표는 h(캐릭터 길이) 비율입니다. 오른쪽을 향한 기준 자세로
       그리세요 (회전·좌우반전은 코드가 처리).
       6조각(torso/head/arm/leg/fin/bag) 전부 실제 텍스처(질감이 든 PNG)가
       들어간 조각이라 원본을 그대로 그립니다(RENDER.tint() 미적용).
         hae_torso — 몸통(팔·머리 제외) 실루엣. 원점(0,0) 기준.
         hae_head  — 머리(물안경 제외) 원. 원점 기준 고정 위치.
         hae_arm   — 어깨 피벗(HAE_SHOULDER) 기준. +x 방향이 기본자세.
         hae_leg   — 다리(허벅지~발목). 엉덩이 피벗(HAE_HIP_X) 기준,
                     +x 방향이 기본자세. 발차기마다 엉덩이~발목 거리에
                     맞춰 가로로 늘였다 줄었다 한다(HAE_LEG_REST_LEN).
         hae_fin   — 발목 피벗(발차기 때마다 이동) 기준.
         hae_bag   — 망사리 중심 기준. 무게에 따라 균일 스케일.
       조각이 없으면 그 부분만 기존 벡터 도형으로 자동 폴백됩니다.
     ============================================================ */
  var HAE_SHOULDER          = { x: 0.16, y: 0.03 };
  var HAE_ARM_REST_ANGLE    = 0.78;    /* 평소 — 팔을 아래로 늘어뜨림 */
  /* ★ 채집 중 팔 각도는 0(로컬 정면) 그대로 둔다 — game.js 의 P.ang 이
     이미 채집물을 정확히 바라보도록 맞춰지므로(몸 회전 기준 로컬 0도 =
     정면), 팔도 추가 각도 없이 몸이 향한 쪽을 그대로 가리키면 채집물과
     정확히 일치한다. 예전에는 -0.05 같은 고정값이라 채집물 방향과
     무관했다. */
  var HAE_ARM_HARVEST_ANGLE = 0;
  /* ★ 팔 1.2배 — 박스 w/h 를 그대로 키운다(길이 제약이 없는 조각이라 간단하다) */
  var HAE_ARM_BOX    = { x: -0.02 * 1.2, y: -0.05 * 1.2, w: 0.48 * 1.2, h: 0.10 * 1.2 };  /* 어깨 피벗 기준 로컬 박스 */
  var HAE_TORSO_BOX  = { x: -0.22, y: -0.20, w: 0.58, h: 0.38 };  /* 원점 기준 */
  var HAE_HEAD_BOX   = { x:  0.24, y: -0.16, w: 0.32, h: 0.32 };  /* 원점 기준 */
  var HAE_FIN_BOX    = { x: -0.24, y: -0.11, w: 0.30, h: 0.22 };  /* 발목 피벗 기준 */
  var HAE_BAG_BOX    = { x: -0.17, y: -0.14, w: 0.34, h: 0.28 };  /* 망사리 중심(반경 h*0.15) 기준 */
  var HAE_HIP_X        = -0.16;   /* 엉덩이 피벗 x (h 비율). y 는 웅크림(cu)에 따라 움직여 상수가 아니다 */
  /* ★ 다리 확대 누적 배율 — 처음 1.5배(두께만) → 길이도 같이 1.5배 →
     이번에 1.3배 추가. 총 1.5*1.3 = 1.95배. ankleX 는 HAE_LEG_REST_LEN 을
     그대로 따라가므로 여기 숫자만 바꾸면 발목·오리발 위치도 같이 늘어난다. */
  var HAE_LEG_SCALE     = 1.5 * 1.3;
  var HAE_LEG_REST_LEN  = 0.34 * HAE_LEG_SCALE;   /* 평소(발차기 0) 엉덩이~발목 거리 */
  var HAE_LEG_BOX       = { x: 0, y: -0.045 * HAE_LEG_SCALE, w: HAE_LEG_REST_LEN, h: 0.09 * HAE_LEG_SCALE };  /* 엉덩이 피벗 기준 */

  function drawDiver(g, P, h, curl, kickPhase, kickAmp, bagRatio, harvesting, col, bagPopT01, standing) {
    var w = h * 0.30;
    g.save();
    g.translate(P.x, P.y);
    g.rotate(P.ang);
    /* ★ 왼쪽을 향할 때 상하 반전 */
    if (Math.cos(P.ang) < 0) g.scale(1, -1);

    var c = col || rgb(COL.diver);
    var cu = curl * h * 0.30;      /* 웅크림 — 몸통 곡률만 바꾼다 */

    /* 다리 — 엉덩이 피벗 기준 관절. 이미지가 없으면 예전처럼
       발목까지 이어지는 얇은 연결선(절차적)으로 폴백 + 오리발(관절) */
    var kp = Math.sin(kickPhase) * kickAmp;
    var hipX = HAE_HIP_X*h, hipY = cu*0.5;
    /* ★ 발목은 엉덩이에서 HAE_LEG_REST_LEN 만큼 떨어진 자리 — 다리 길이를
       바꾸면 이 거리도 같이 바뀌어야 다리 이미지가 발목까지 정확히 닿는다 */
    var ankleX = hipX - HAE_LEG_REST_LEN*h, ankleY = cu*0.5 + kp*h*0.34;
    var legImg = SPRITES['hae_leg'];
    if (legImg) {
      var legDx = ankleX - hipX, legDy = ankleY - hipY;
      var legLen = Math.hypot(legDx, legDy);
      g.save();
      g.translate(hipX, hipY);
      g.rotate(Math.atan2(legDy, legDx));
      g.scale(legLen / (HAE_LEG_REST_LEN * h), 1);
      g.drawImage(legImg, HAE_LEG_BOX.x*h, HAE_LEG_BOX.y*h, HAE_LEG_BOX.w*h, HAE_LEG_BOX.h*h);
      g.restore();
    } else {
      g.strokeStyle = c; g.lineCap = 'round';
      g.lineWidth = w * 0.30;
      g.beginPath();
      g.moveTo(hipX, hipY);
      g.quadraticCurveTo(-h*0.34, cu*0.6 + kp*h*0.16, ankleX, ankleY);
      g.stroke();
    }
    g.save();
    g.translate(ankleX, ankleY);
    g.rotate(kp * 0.5);
    var finImg = SPRITES['hae_fin'];
    if (finImg) {
      g.drawImage(finImg, HAE_FIN_BOX.x*h, HAE_FIN_BOX.y*h, HAE_FIN_BOX.w*h, HAE_FIN_BOX.h*h);
    } else {
      g.fillStyle = c;
      g.beginPath(); g.ellipse(-h*0.09, 0, h*0.11, w*0.30, 0, 0, 6.2832); g.fill();
    }
    g.restore();

    /* 몸통 */
    var torsoImg = SPRITES['hae_torso'];
    if (torsoImg) {
      g.drawImage(torsoImg, HAE_TORSO_BOX.x*h, HAE_TORSO_BOX.y*h, HAE_TORSO_BOX.w*h, HAE_TORSO_BOX.h*h);
    } else {
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(h*0.34, -w*0.36);
      g.quadraticCurveTo(h*0.02, -w*0.62 + cu*0.35, -h*0.20, -w*0.20 + cu*0.75);
      g.lineTo(-h*0.18, w*0.28 + cu*0.75);
      g.quadraticCurveTo(h*0.02, w*0.52 + cu*0.35, h*0.34, w*0.32);
      g.closePath();
      g.fill();
    }

    /* 망사리 — 엉덩이 피벗 근처에 매달린다. 무거울수록 부푼다.
       방금 도착한 게 있으면 살짝 팝. ★ 몸통보다 뒤에 그려야 몸 앞으로
       보인다 — 예전엔 몸통보다 먼저 그려서 몸통에 가려 안 보였다. */
    var popK = bagPopT01 || 0;
    var bagPopScale = 1 + popK * 0.5;
    var bagBaseR = h * 0.15;
    var bagR = h * (0.15 + bagRatio * 0.20) * bagPopScale;
    var bagImg = SPRITES['hae_bag'];
    var bagX = HAE_HIP_X*h, bagY = cu*0.55;
    g.save();
    g.translate(bagX, bagY);
    if (bagImg) {
      var bs = bagR / bagBaseR;
      g.scale(bs, bs);
      g.drawImage(bagImg, HAE_BAG_BOX.x*h, HAE_BAG_BOX.y*h, HAE_BAG_BOX.w*h, HAE_BAG_BOX.h*h);
    } else {
      g.fillStyle = 'rgba(20,40,44,0.72)';
      g.beginPath(); g.ellipse(0, 0, bagR*1.05, bagR*0.86, 0, 0, 6.2832); g.fill();
    }
    g.restore();
    g.strokeStyle = 'rgba(150,196,204,0.30)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-h*0.36, cu*0.32); g.lineTo(bagX, bagY); g.stroke();
    if (bagRatio > 0.02) {
      g.fillStyle = 'rgba(120,190,180,' + (0.13 + bagRatio*0.24) + ')';
      g.beginPath(); g.ellipse(bagX, bagY, bagR*0.72, bagR*0.58, 0, 0, 6.2832); g.fill();
    }

    /* 팔 — 채집 중이면 어깨 관절이 앞으로 회전한다.
       ★ standing(헤엄치지 않고 수직으로 서 있는 자세, 예: 구조 연출)이면
       평소 각도에 180도를 더해 팔이 아래(발 쪽)를 향하게 한다 — 헤엄칠 때
       기준으로 잡은 각도가 수직 자세에서는 그대로 위를 향해버리기 때문. */
    var armImg = SPRITES['hae_arm'];
    if (armImg) {
      g.save();
      g.translate(HAE_SHOULDER.x*h, HAE_SHOULDER.y*h + cu*0.4);
      var armAngle = harvesting ? HAE_ARM_HARVEST_ANGLE : HAE_ARM_REST_ANGLE;
      if (standing && !harvesting) armAngle += Math.PI;
      g.rotate(armAngle);
      g.drawImage(armImg, HAE_ARM_BOX.x*h, HAE_ARM_BOX.y*h, HAE_ARM_BOX.w*h, HAE_ARM_BOX.h*h);
      g.restore();
    } else {
      g.strokeStyle = c;
      g.lineWidth = w * 0.24;
      g.beginPath();
      g.moveTo(h*0.16, w*0.10 + cu*0.4);
      if (harvesting) g.quadraticCurveTo(h*0.42, w*0.16, h*0.60, w*0.02);
      else g.quadraticCurveTo(h*0.34, w*0.34 + cu*0.3, h*0.30, w*0.56 + cu*0.4);
      g.stroke();
    }

    /* 머리 — 몸통 위에 고정 (독립 관절 없음) */
    var headImg = SPRITES['hae_head'];
    if (headImg) {
      g.drawImage(headImg, HAE_HEAD_BOX.x*h, HAE_HEAD_BOX.y*h, HAE_HEAD_BOX.w*h, HAE_HEAD_BOX.h*h);
    } else {
      /* ★ 물안경 광택 — 머리가 단색 폴백 원일 때만 그린다. 실제 텍스처
         (hae_head 사진)에는 이미 물안경이 그려져 있어서, 예전엔 여기서
         무조건 겹쳐 그려 물안경이 두 개로 보이는 버그가 있었다. */
      g.fillStyle = c;
      g.beginPath(); g.arc(h*0.40, -w*0.02, h*0.145, 0, 6.2832); g.fill();
      g.fillStyle = 'rgba(150,214,226,0.62)';
      g.beginPath(); g.ellipse(h*0.47, -w*0.10, h*0.062, h*0.048, -0.2, 0, 6.2832); g.fill();
    }
    /* 빗창 */
    g.strokeStyle = 'rgba(178,190,192,0.55)'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(h*0.24, w*0.30 + cu*0.4); g.lineTo(h*0.10, w*0.62 + cu*0.5); g.stroke();

    g.restore();
  }


  /* ============================================================
     수면 경계 — 오프스크린 수중 버퍼 + 하늘/먼바다 + 굴절 합성
     ★ 수중 전체(3층 조명 포함)를 먼저 오프스크린에 그린 뒤,
       근수면선(물결) 아래로만 잘라 메인 캔버스에 합성한다.
       그래야 수면 위(하늘/먼바다)와 수면 아래가 같은 프레임 안에서
       자연스럽게 이어진다.
     ============================================================ */
  var underCv = null, underCtx = null;
  function ensureUnderCanvas() {
    if (!underCv) {
      underCv = document.createElement('canvas');
      underCtx = underCv.getContext('2d', { alpha: false });
    }
    if (underCv.width !== cv.width || underCv.height !== cv.height) {
      underCv.width = cv.width; underCv.height = cv.height;
    }
  }

  /* 두 개의 sin 을 합성한 물결 경로 — 월드 x 기준이라 카메라가 움직여도 흐르듯 이어진다 */
  function waveOffset(worldX) {
    return Math.sin(worldX * 0.013 + T * 1.25) * CONFIG.WAVE_AMP
         + Math.sin(worldX * 0.034 - T * 0.85) * CONFIG.WAVE_AMP * 0.45;
  }
  function waveScreenY(cam, surf, sx) {
    return surf + waveOffset(sx / cam.zoom + cam.cx) * cam.zoom;
  }
  function buildWavePoints(cam, surf) {
    var pts = [], step = 8, sx;
    for (sx = 0; sx < W; sx += step) pts.push([sx, waveScreenY(cam, surf, sx)]);
    pts.push([W, waveScreenY(cam, surf, W)]);
    return pts;
  }
  function traceWavePath(g, pts, dy) {
    g.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var x = pts[i][0], y = pts[i][1] + (dy || 0);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
  }

  /* 배경 장식 좌표 — seed 로 고정. 매 프레임 새로 뽑지 않는다 */
  var SKY_ISLANDS = [
    { bx: -260, w: 240, h: 44 },
    { bx: 1120, w: 170, h: 30 }
  ];
  var SKY_GULLS = [
    { ph: 0.0, sp: 26, dy: 132 },
    { ph: 2.3, sp: 21, dy: 168 },
    { ph: 4.1, sp: 30, dy: 100 },
    { ph: 1.4, sp: 24, dy: 190 }
  ];
  var SKY_WRAP_X = 2200;
  function skyParX(cam, worldX, factor) {
    var rel = worldX - cam.cx * factor;
    rel = ((rel % SKY_WRAP_X) + SKY_WRAP_X) % SKY_WRAP_X;
    return rel - SKY_WRAP_X * 0.5 + W * 0.5;
  }

  /* ② 하늘 / 먼바다 — 근수면선(flat) 위, HORIZON_OFFSET 만큼 떨어진 수평선까지 */
  function drawSkyFar(cam, surf) {
    var horizonY = surf - CONFIG.HORIZON_OFFSET * cam.zoom;

    /* 하늘 */
    var skyTopY = horizonY - 700;
    var sg = ctx.createLinearGradient(0, skyTopY, 0, horizonY);
    sg.addColorStop(0, rgb(COL.skyTop));
    sg.addColorStop(1, rgb(COL.skyLow));
    ctx.fillStyle = sg;
    ctx.fillRect(0, skyTopY, W, horizonY - skyTopY);

    /* 먼 섬 실루엣 — 정적, 카메라 x 의 12% 만 패럴랙스 */
    ctx.fillStyle = 'rgba(52,76,88,0.55)';
    for (var i = 0; i < SKY_ISLANDS.length; i++) {
      var isl = SKY_ISLANDS[i];
      var ix = skyParX(cam, isl.bx, 0.12);
      var iw = isl.w * cam.zoom, ih = isl.h * cam.zoom;
      ctx.beginPath();
      ctx.moveTo(ix - iw * 0.5, horizonY);
      ctx.quadraticCurveTo(ix - iw * 0.18, horizonY - ih, ix + iw * 0.10, horizonY - ih * 0.86);
      ctx.quadraticCurveTo(ix + iw * 0.36, horizonY - ih * 0.4, ix + iw * 0.5, horizonY);
      ctx.closePath(); ctx.fill();
    }

    /* 갈매기 */
    var q = SETTINGS.quality;
    if (q > 0) {
      ctx.strokeStyle = 'rgba(22,30,34,0.55)';
      ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (var gI = 0; gI < SKY_GULLS.length; gI++) {
        var g0 = SKY_GULLS[gI];
        var gx = ((T * g0.sp + g0.ph * 160) % (W + 220)) - 110;
        var gy = horizonY - g0.dy * cam.zoom;
        if (gy < skyTopY || gy > horizonY) continue;
        var flap = Math.sin(T * 6 + g0.ph) * 5;
        ctx.beginPath();
        ctx.moveTo(gx - 9, gy - flap); ctx.quadraticCurveTo(gx - 4, gy - 2, gx, gy);
        ctx.quadraticCurveTo(gx + 4, gy - 2, gx + 9, gy - flap);
        ctx.stroke();
      }
    }

    /* 먼바다 — 수평선 ~ 근수면선. 촘촘해지는 반짝임으로 원근감 */
    var bandH = surf - horizonY;
    if (bandH > 0.5) {
      var farCol = mixC(COL.skyLow, COL.waterTop, 0.62);
      var fg = ctx.createLinearGradient(0, horizonY, 0, surf);
      fg.addColorStop(0, rgb(COL.skyLow));
      fg.addColorStop(1, rgb(farCol));
      ctx.fillStyle = fg;
      ctx.fillRect(0, horizonY, W, bandH);

      var rows = q === 0 ? 5 : (q === 1 ? 8 : 12);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      for (var r = 0; r < rows; r++) {
        var f = rows > 1 ? r / (rows - 1) : 0;
        var ry = horizonY + Math.pow(f, 1.6) * bandH;
        var dashN = Math.round(lerp(20, 4, f));
        ctx.globalAlpha = lerp(0.16, 0.34, f) * (q === 0 ? 0.7 : 1);
        ctx.beginPath();
        for (var d = 0; d < dashN; d++) {
          var dx = ((d / dashN) * W + (r * 53 + T * 18) % (W / dashN)) % W;
          ctx.moveTo(dx, ry); ctx.lineTo(dx + Math.max(2, 10 * (1 - f)), ry);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ③ 수면선 자체 — 포말 + 보조선 + 표층 발광 */
  function drawWaterline(cam, surf, pts) {
    if (CONFIG.FOAM > 0.001) {
      ctx.strokeStyle = rgba(COL.foam, CONFIG.FOAM);
      ctx.lineWidth = 2;
      traceWavePath(ctx, pts, 0); ctx.stroke();
      ctx.strokeStyle = rgba(COL.foamGlow, CONFIG.FOAM * 0.5);
      ctx.lineWidth = 1.4;
      traceWavePath(ctx, pts, 5); ctx.stroke();
    }
    if (CONFIG.SUBSURF_GLOW > 0.001) {
      var gg = ctx.createLinearGradient(0, surf, 0, surf + 70);
      gg.addColorStop(0, rgba(COL.subsurfGlow, 0.30 * CONFIG.SUBSURF_GLOW));
      gg.addColorStop(1, rgba(COL.subsurfGlow, 0));
      ctx.fillStyle = gg;
      ctx.fillRect(0, surf, W, 70);
    }
  }

  /* ★ 해녀가 수면 근처에 떠 있을 때, 오프스크린 수중 렌더는 근수면선에서
     하드 클립되기 때문에 물결이 골(트로프)로 내려오면 해녀가 그 구간만큼
     잘려 보인다. 처음엔 "잘리는 프레임에만 반투명 해녀를 겹쳐 그리는"
     방식으로 고쳤지만, 그 반투명 사본이 위치와 무관하게 알파값이
     고정(0.55)이라 물결선을 기준으로 밝기가 뚝 끊기는 자국이 남았다.
     ★ 지금은 항상(수면 근처일 때) 별도 캔버스에 해녀를 그린 뒤, 물결선
     기준 세로 그라디언트로 알파를 마스킹한다 — 물결선보다 얕은 쪽은 알파 1
     (원래도 클립 밖이라 아무것도 없던 자리라 이 레이어가 사실상 유일한
     해녀), 물결선부터 FEATHER px 만큼 아래로 내려가며 서서히 알파 0 으로
     — 이미 수중 렌더가 100% 로 보여주는 구간이라 겹쳐도 티가 안 난다.
     경계선에서 양쪽 다 알파 ~1 로 이어지므로 끊기는 지점이 생기지 않는다. */
  var ghostCv = null, ghostCtx = null;
  function ensureGhostCanvas(w, h) {
    if (!ghostCv) { ghostCv = document.createElement('canvas'); ghostCtx = ghostCv.getContext('2d'); }
    if (ghostCv.width !== w || ghostCv.height !== h) { ghostCv.width = w; ghostCv.height = h; }
  }
  function drawDiverSurfaceBlend(cam, G, surf) {
    var P = G.player;
    if (P.y > 90) return;   /* 물결이 닿을 수 있는 범위 밖이면 필요 없다 */
    var ps = w2s(cam, P.x, P.y);
    if (ps.x < -60 || ps.x > W + 60) return;
    var waveY = waveScreenY(cam, surf, ps.x);

    var h = H * CONFIG.CHAR_HEIGHT_PCT * cam.zoom;
    var feather = 30 * cam.zoom;
    var pad = h * 1.3;
    /* ★ cw/ch 는 논리(CSS) 픽셀 크기 — 실제 백킹 스토어는 DPR 배로 만들고
       ghostCtx 에도 메인 캔버스와 같은 DPR 변환을 걸어야 한다. 예전엔 여기만
       1배로 그려서, 수면 근처(이 블렌드가 켜지는 구간)에서만 유독 흐려
       보였다 — 수중 오프스크린(underCv)은 처음부터 cv.width 를 그대로
       썼는데 이 고스트 캔버스만 빠져 있었다. */
    var cw = Math.ceil(pad * 2), ch = Math.ceil(pad * 2);
    ensureGhostCanvas(Math.ceil(cw * DPR), Math.ceil(ch * DPR));
    ghostCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ghostCtx.clearRect(0, 0, cw, ch);
    ghostCtx.save();
    ghostCtx.translate(pad, pad);
    var kickAmp = 0.35 + (1 - G.o2 / G.o2Max) * 0.45;
    drawDiver(ghostCtx, { x: 0, y: 0, ang: P.ang }, h, P.curl, P.kick, kickAmp,
              G.bagRatio, G.harvest.t > 0, rgb(COL.diver), G.bagPopT / CONFIG.BAG_POP, !G.submerged);
    ghostCtx.restore();

    /* 물결선(로컬 좌표) 위로는 그대로, 아래로는 FEATHER 만큼 서서히 사라진다 */
    var localWaveY = pad + (waveY - ps.y);
    ghostCtx.globalCompositeOperation = 'destination-in';
    var grad = ghostCtx.createLinearGradient(0, localWaveY, 0, localWaveY + feather);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ghostCtx.fillStyle = grad;
    ghostCtx.fillRect(0, 0, cw, ch);
    ghostCtx.globalCompositeOperation = 'source-over';

    /* ★ 목적지 크기를 논리 픽셀(cw,ch)로 명시해야 한다 — 안 그러면 이미
       DPR 배로 커진 소스 이미지 크기를 그대로 쓰면서 현재 컨텍스트의 DPR
       변환까지 다시 곱해져 캔버스 밖으로 두 배 커져버린다. */
    ctx.drawImage(ghostCv, ps.x - pad, ps.y - pad, cw, ch);
  }

  /* ④ 굴절 — 근수면선 기준 REFRACT_BAND px 만 가로 오프셋을 주며 합성.
     나머지는 오프셋 없는 drawImage 1회. 좁은 밴드만 왜곡해 성능과
     자연스러움을 함께 가져간다. */
  function compositeUnderwater(cam, surf, pts) {
    ctx.save();
    traceWavePath(ctx, pts, 0);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.clip();

    var margin = CONFIG.WAVE_AMP * 1.6 * cam.zoom + 4;   /* 물결 최대 진폭보다 넉넉히 위에서 시작 */
    var bandTop = surf - margin;
    var bandBottom = surf + CONFIG.REFRACT_BAND * cam.zoom;
    var srcW = underCv.width, srcH = underCv.height;

    /* ★ 심해에서는 근수면선(surf)이 화면 훨씬 위쪽(음수)으로 벗어난다.
       이때 bandTop/bandBottom 을 그대로 drawImage 좌표에 쓰면 대상 사각형이
       화면 밖까지 수천 px 로 부풀어(예: dest height = H - bandBottom) 오프스크린
       버퍼가 극단적으로 세로로 늘어나 그려지는 사고가 났다 — 심해에서 장면이
       뭉개지거나 텅 비어 보이던 원인. 밴드가 화면 안에 걸칠 때만 슬라이스를
       돌고, 아니면 왜곡 없이 그대로 한 번에 블릿한다. */
    if (bandBottom <= 0 || bandTop >= H) {
      ctx.drawImage(underCv, 0, 0, srcW, srcH, 0, 0, W, H);
    } else {
      var sliceH = 6;
      var loopEnd = Math.min(bandBottom, H);
      var y = Math.max(bandTop, 0);
      while (y < loopEnd) {
        var fall = clamp(1 - (y - surf) / (CONFIG.REFRACT_BAND * cam.zoom || 1), 0, 1);
        var yWorld = y + cam.cy;
        var off = Math.sin(yWorld * 0.055 + T * CONFIG.REFRACT_SPEED) * CONFIG.REFRACT_AMP * fall * fall;
        var sy = Math.round(y * DPR);
        var sh = Math.round(sliceH * DPR);
        if (sy + sh > srcH) sh = srcH - sy;
        if (sh > 0) ctx.drawImage(underCv, 0, sy, srcW, sh, off, y, W, sliceH);
        y += sliceH;
      }
      if (loopEnd < H) {
        var rsy = Math.round(loopEnd * DPR);
        var rsh = srcH - rsy;
        if (rsh > 0) ctx.drawImage(underCv, 0, rsy, srcW, rsh, 0, loopEnd, W, H - loopEnd);
      }
    }
    ctx.restore();
  }


  /* ============================================================
     잠수 화면
     ============================================================ */
  function drawDive(G, dtRaw) {
    T += dtRaw;
    var cam = G.cam, P = G.player, B = G.badang;
    var pd = depthRatio(P.y);
    var WORLD_H = CONFIG.VIS_DEPTH_REF * CONFIG.PIXELS_PER_METER;
    var floorY = B.depthM * CONFIG.PIXELS_PER_METER;
    var q = SETTINGS.quality;

    ensureUnderCanvas();
    var mainCtx = ctx;
    var surf = w2s(cam, 0, 0).y;
    var wavePts = buildWavePoints(cam, surf);

    /* ── 1) 수중 전체를 오프스크린에 렌더 (기존 3층 조명 포함) ──
       ★ ctx 를 오프스크린으로 잠시 바꿔치기한다. 아래의 모든 draw* 헬퍼가
         모듈 스코프의 ctx 를 그대로 쓰므로 별도 인자 전달이 필요 없다. */
    ctx = underCtx;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    /* ── 1. 물 배경 — 화면 상/하단 수심에 따른 세로 그라디언트
       ★ 수면 기준색은 현재 잠수 중인 바당의 B.tint 를 쓴다. 예전엔 바당과
       무관하게 항상 BADANG[0]('여')의 tint 를 썼는데, 그 바람에 디버그
       패널의 "수면 근처 바닷물 색"이 여가 아닌 다른 바당에서는 값을
       바꿔도 화면에 전혀 반영되지 않는 버그가 있었다. ── */
    var topW  = cam.cy - (H/2) / cam.zoom;
    var botW  = cam.cy + (H/2) / cam.zoom;
    var surfaceTint = B.tint;
    var wTop = mixC(surfaceTint, COL.waterDeep, depthRatio(topW));
    var wBot = mixC(surfaceTint, COL.waterDeep, depthRatio(botW));
    var g0 = ctx.createLinearGradient(0, 0, 0, H);
    g0.addColorStop(0, rgb(wTop));
    g0.addColorStop(1, rgb(wBot));
    ctx.fillStyle = g0;
    ctx.fillRect(0, 0, W, H);

    /* ── 월드 좌표계 진입 ── */
    ctx.save();
    ctx.translate(W/2 + cam.sx, H/2 + cam.sy);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.cx, -cam.cy);

    var viewL = cam.cx - (W/2)/cam.zoom - 120;
    var viewR = cam.cx + (W/2)/cam.zoom + 120;
    var viewT = cam.cy - (H/2)/cam.zoom - 200;
    var viewB = cam.cy + (H/2)/cam.zoom + 200;
    var i, o;

    /* ── 2. 원경 바위 ── */
    for (i = 0; i < G.rocks.length; i++) {
      o = G.rocks[i];
      if (o.layer !== 0 || o.x < viewL || o.x > viewR || o.y < viewT || o.y > viewB) continue;
      ctx.fillStyle = rockFillGradient(o, o.r * 1.18, 0.40, rockColorAt(B, o.y));
      rockPath(ctx, o, 1.18);
      ctx.fill();
    }

    /* ── 3. ★ 빛기둥 (additive). 물체보다 뒤, 안개보다 앞 ── */
    var shaftN = q === 0 ? 0 : (q === 1 ? Math.min(1, G.shafts.length) : G.shafts.length);
    if (shaftN > 0) {
      var spr = getShaftSprite();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = B.shaftAlpha;
      for (i = 0; i < shaftN; i++) {
        var sh = G.shafts[i];
        /* ★ 흔들림은 평행이동이 아니라 수면을 축으로 한 각도 진동.
           실제 물속 빛기둥은 수면의 물결이 굴절각을 바꿔서 흔들린다.
           아래쪽이 크게 쓸린다. */
        var m = shaftMotion(sh);
        ctx.save();
        ctx.translate(sh.x + m.sw * 26, 0);
        ctx.rotate(m.angle);
        ctx.scale(m.breath, 1);
        ctx.drawImage(spr, -spr.width/2, 0, spr.width, WORLD_H);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    /* ── 4. 근경 바위 / 해저 ── */
    ctx.fillStyle = rgba(COL.sand, 0.55);
    ctx.fillRect(-200, floorY, CONFIG.WORLD_WIDTH + 400, 400);
    ctx.fillStyle = rgba(rockColorAt(B, floorY), 0.9);
    ctx.beginPath();
    ctx.moveTo(-200, floorY + 8);
    for (var fx = -200; fx <= CONFIG.WORLD_WIDTH + 200; fx += 40) {
      ctx.lineTo(fx, floorY + Math.sin(fx * 0.013) * 9 + Math.sin(fx * 0.041) * 4);
    }
    ctx.lineTo(CONFIG.WORLD_WIDTH + 200, floorY + 400);
    ctx.lineTo(-200, floorY + 400);
    ctx.closePath(); ctx.fill();

    for (i = 0; i < G.rocks.length; i++) {
      o = G.rocks[i];
      if (o.layer !== 1 || o.x < viewL || o.x > viewR || o.y < viewT || o.y > viewB) continue;
      ctx.fillStyle = rockFillGradient(o, o.r, 0.88, rockColorAt(B, o.y));
      rockPath(ctx, o, 1);
      ctx.fill();
      /* 윗면 — 위에서 내려오는 빛을 받는 면만 살짝 밝게 */
      ctx.fillStyle = 'rgba(150,196,206,0.06)';
      ctx.beginPath();
      ctx.ellipse(o.x, o.y - o.r * 0.30, o.r * 0.62, o.r * 0.16, o.rot, 0, 6.2832);
      ctx.fill();
    }

    /* 월드 좌우 벽 — 수면 아래로만. 하늘까지 덮으면 띠처럼 보인다.
       카메라가 월드 밖으로 나가지 않으므로 평소에는 화면에 걸리지 않고,
       줌아웃 연출에서만 가장자리에 암벽으로 드러난다.
       ★ 벽은 y=0(수면)~WORLD_H(=VIS_DEPTH_REF 기준 심해)를 통째로 덮는
       세로로 긴 도형이라, 개별 오브젝트 색 대신 진짜 세로 선형 그라데이션을 쓴다. */
    var wallGrad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    wallGrad.addColorStop(0, rgb(rockColorAt(B, 0)));
    wallGrad.addColorStop(1, rgb(rockColorAt(B, WORLD_H)));
    ctx.fillStyle = wallGrad;
    ctx.beginPath();
    ctx.moveTo(-300, 0); ctx.lineTo(0, 0);
    for (var wy2 = 0; wy2 <= WORLD_H; wy2 += 60) ctx.lineTo(Math.sin(wy2 * 0.013) * 14 - 6, wy2);
    ctx.lineTo(-300, WORLD_H + 400); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    var WX = CONFIG.WORLD_WIDTH;
    ctx.moveTo(WX + 300, 0); ctx.lineTo(WX, 0);
    for (var wy3 = 0; wy3 <= WORLD_H; wy3 += 60) ctx.lineTo(WX - Math.sin(wy3 * 0.011) * 14 + 6, wy3);
    ctx.lineTo(WX + 300, WORLD_H + 400); ctx.closePath(); ctx.fill();

    /* ── 감태 (뒤쪽) ── */
    drawKelp(G, viewL, viewR, false);

    /* ── 관찰 생물 ── */
    for (i = 0; i < G.observers.length; i++) {
      o = G.observers[i];
      if (!o.alive) continue;
      var osp = SPECIES_BY_ID[o.id];
      var ocol = applyColorLoss(osp.col, o.x, o.y, B, G, P);
      ctx.save();
      ctx.translate(o.x, o.y);
      if (o.dir < 0) ctx.scale(-1, 1);
      ctx.globalAlpha = o.fade;
      drawObserverShape(ctx, osp, 1, ocol, T);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    /* ── 채집물 ── */
    for (i = 0; i < G.critters.length; i++) {
      var c = G.critters[i];
      if (c.taken || c.x < viewL || c.x > viewR || c.y < viewT || c.y > viewB) continue;
      var sp = SPECIES_BY_ID[c.id];
      var col = applyColorLoss(sp.col, c.x, c.y, B, G, P);
      /* 감태숲 — 감태 뒤의 채집물은 알파 0.3, 근접 시 선명. 가리기만 한다 */
      var a = 1;
      if (B.kelp > 0 && c.occluded) {
        var dd = Math.hypot(c.x - P.x, c.y - P.y);
        a = 0.30 + 0.70 * clamp(1 - dd / 240, 0, 1);
      }
      /* 채집 저항 중이면 떨림. STAGE2("버티기")에서 가장 크게 흔들린다 */
      var isChanneling = (G.harvest.target === c && G.harvest.t > 0);
      var trX = 0, trY = 0;
      if (isChanneling) {
        var trF = G.harvest.stage === 2 ? 1.0 : (G.harvest.stage === 3 ? 0.55 : 0.35);
        var trAmt = CONFIG.TREMBLE * trF;
        trX = Math.sin(T * 23 + c.ph * 7) * trAmt;
        trY = Math.cos(T * 19 + c.ph * 5) * trAmt * 0.6;
      }

      ctx.globalAlpha = a;
      ctx.save(); ctx.translate(c.x + trX, c.y + trY); ctx.rotate(c.rot);
      drawCritter(ctx, sp, sp.r, col);
      ctx.restore();
      ctx.globalAlpha = 1;

      /* ★ 전부 바위 위에 얹혀 보이지 않도록 — 70%(behindRock)는 진짜 바위와
         같은 들쭉날쭉한 실루엣(rockPath)을 채집물 자신의 크기 기준으로 그려
         아랫부분을 덮는다. 매끈한 타원이면 "바위색을 칠한 것"처럼 보여서,
         실제 바위와 같은 rockPath 노이즈 모양을 그대로 재사용해야 진짜
         바위 조각에 가려진 것처럼 읽힌다. 실제 perchRock 폴리곤을 그대로
         쓰면 모양이 채집물 위치까지 안 닿는 경우가 있어(간격 발생),
         채집물 기준 상대 크기의 합성 바위로 그려야 항상 확실히 겹친다. */
      if (c.behindRock) {
        var coverRock = {
          x: c.x, y: c.y + sp.r * 0.55, r: sp.r * 1.3,
          rot: c.coverRot, seed: c.coverSeed
        };
        ctx.fillStyle = rgba(rockColorAt(B, c.y), 0.92);
        rockPath(ctx, coverRock, 1);
        ctx.fill();
        ctx.fillStyle = 'rgba(150,196,206,0.06)';
        ctx.beginPath();
        ctx.ellipse(coverRock.x, coverRock.y - coverRock.r * 0.30, coverRock.r * 0.62, coverRock.r * 0.16, coverRock.rot, 0, 6.2832);
        ctx.fill();
      }

      /* ★ 채집 게이지 — UI 가 아니라 채집물 주위에 다이제틱하게.
         구간마다 색이 다르고, 버티기 구간의 경계를 짧은 눈금으로 보여준다. */
      if (isChanneling) {
        var pr = clamp(G.harvest.prog, 0, 1);
        var ringR = sp.r + 12;
        var stageCol = G.harvest.stage === 1 ? 'rgba(214,238,246,0.92)'
                      : G.harvest.stage === 2 ? 'rgba(232,150,90,0.95)'
                      : 'rgba(160,232,170,0.95)';
        ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(c.x, c.y, ringR, 0, 6.2832); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(c.x, c.y, ringR, 0, 6.2832); ctx.stroke();
        ctx.strokeStyle = stageCol; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(c.x, c.y, ringR, -1.5708, -1.5708 + pr * 6.2832); ctx.stroke();
        ctx.strokeStyle = 'rgba(10,14,16,0.55)'; ctx.lineWidth = 2;
        [CONFIG.STAGE1_END, CONFIG.STAGE2_END].forEach(function (frac) {
          var tang = -1.5708 + frac * 6.2832;
          ctx.beginPath();
          ctx.moveTo(c.x + Math.cos(tang)*(ringR-4), c.y + Math.sin(tang)*(ringR-4));
          ctx.lineTo(c.x + Math.cos(tang)*(ringR+4), c.y + Math.sin(tang)*(ringR+4));
          ctx.stroke();
        });
      }
    }

    /* ── 완료된 채집물이 베지어 곡선을 그리며 망사리로 날아간다.
       무게는 game.js 의 updateFlying() 이 도착 시점에 더한다. ── */
    for (i = 0; i < G.flying.length; i++) {
      var fl = G.flying[i];
      var flsp = SPECIES_BY_ID[fl.id];
      var ft = clamp(fl.t / fl.dur, 0, 1);
      var fe = 1 - Math.pow(1 - ft, 2);
      var ex = P.x, ey = P.y + 6;
      var ctlX = lerp(fl.x0, ex, 0.5), ctlY = lerp(fl.y0, ey, 0.5) - 44;
      var fbx = lerp(lerp(fl.x0, ctlX, fe), lerp(ctlX, ex, fe), fe);
      var fby = lerp(lerp(fl.y0, ctlY, fe), lerp(ctlY, ey, fe), fe);
      ctx.save();
      ctx.translate(fbx, fby);
      ctx.rotate(fl.t * 6);
      ctx.scale(1 - fe * 0.25, 1 - fe * 0.25);
      drawCritter(ctx, flsp, flsp.r * 0.9, flsp.col);
      ctx.restore();
    }

    /* ── 흩어지는 채집물 ── */
    for (i = 0; i < FX.scatter.length; i++) {
      var s = FX.scatter[i];
      ctx.globalAlpha = clamp(s.life, 0, 1);
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot);
      drawCritter(ctx, s.sp, s.sp.r * 0.85, s.sp.col);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    /* ── 테왁 — 수면의 세이브 포인트 ── */
    var twy = Math.sin(T * 1.3) * 4;
    ctx.fillStyle = 'rgba(120,180,190,0.30)';
    ctx.beginPath(); ctx.ellipse(CONFIG.TEWAK_X, twy + 6, CONFIG.TEWAK_RADIUS*1.15, CONFIG.TEWAK_RADIUS*0.42, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = rgb(COL.tewak);
    ctx.beginPath(); ctx.arc(CONFIG.TEWAK_X, twy, CONFIG.TEWAK_RADIUS, 0, 6.2832); ctx.fill();
    ctx.fillStyle = 'rgba(224,122,60,0.9)';
    ctx.beginPath(); ctx.arc(CONFIG.TEWAK_X, twy, CONFIG.TEWAK_RADIUS * 0.42, 0, 6.2832); ctx.fill();
    /* 물속에서도 테왁 위치가 읽히도록 얇은 수직선 */
    if (P.y > 140) {
      ctx.strokeStyle = 'rgba(220,240,246,0.12)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 14]);
      ctx.beginPath(); ctx.moveTo(CONFIG.TEWAK_X, twy + 20); ctx.lineTo(CONFIG.TEWAK_X, P.y - 40); ctx.stroke();
      ctx.setLineDash([]);
    }

    /* ── 감태 (앞쪽 — 시야를 가린다) ── */
    drawKelp(G, viewL, viewR, true);

    /* ── 기포 ── */
    ctx.fillStyle = 'rgba(226,244,250,0.5)';
    for (i = 0; i < FX.bubbles.length; i++) {
      var b = FX.bubbles[i];
      ctx.globalAlpha = clamp(b.life, 0, 1) * 0.55;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* ── 모래 파티클 (채집 저항) ── */
    ctx.fillStyle = rgba(B.rockCol, 0.55);
    for (i = 0; i < FX.sand.length; i++) {
      var sd = FX.sand[i];
      ctx.globalAlpha = clamp(sd.life, 0, 1) * 0.7;
      ctx.beginPath(); ctx.arc(sd.x, sd.y, sd.r, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* ── 해녀 ── */
    if (G.rescue) drawRescue(G);
    /* 캐릭터 높이는 월드 단위로 고정. 줌이 커지면 화면에서 커지는 게 맞다
       (물숨 줌 2.0 이 말을 하려면 평소 크기가 가만히 있어야 한다) */
    var kickAmp = 0.35 + (1 - G.o2 / G.o2Max) * 0.45;
    /* ★ standing — 구조될 때뿐 아니라 수면에 떠 있을 때(!G.submerged)도
       팔이 180도 돌아 아래를 향한다 */
    drawDiver(ctx, P, H * CONFIG.CHAR_HEIGHT_PCT, P.curl,
              P.kick, kickAmp, G.bagRatio, G.harvest.t > 0, rgb(COL.diver),
              G.bagPopT / CONFIG.BAG_POP, !G.submerged);

    ctx.restore();
    /* ── 월드 좌표계 종료 ── */

    /* ── 5. 1층 · 균일 감쇠 ── */
    ctx.fillStyle = rgba(COL.waterDeep, pd * CONFIG.DEPTH_ATTEN_MAX);
    ctx.fillRect(0, 0, W, H);

    /* ── 6. 2층 · 가시거리 마스크 ── */
    var radius = lerp(CONFIG.VIS_RADIUS_SHALLOW, CONFIG.VIS_RADIUS_DEEP, pd) * cam.zoom;
    if (q === 0) radius *= 1.15;
    var fspr = getFogSprite(radius, CONFIG.VIS_SOFTNESS, CONFIG.VIS_TINT_ALPHA);
    var ps = w2s(cam, P.x, P.y);
    var R = fspr.width / 2;
    ctx.drawImage(fspr, ps.x - R, ps.y - R);
    /* 스프라이트 바깥은 최대 농도 단색 fillRect 4장으로. 정확하고 저렴하다 */
    ctx.fillStyle = rgba(COL.fog, CONFIG.VIS_TINT_ALPHA);
    var l = ps.x - R, r = ps.x + R, t = ps.y - R, bm = ps.y + R;
    if (t > 0)  ctx.fillRect(0, 0, W, t);
    if (bm < H) ctx.fillRect(0, bm, W, H - bm);
    if (l > 0)  ctx.fillRect(0, Math.max(0,t), l, Math.min(H,bm) - Math.max(0,t));
    if (r < W)  ctx.fillRect(r, Math.max(0,t), W - r, Math.min(H,bm) - Math.max(0,t));

    /* ── 7. 랜턴 ── */
    if (G.lanternOn) {
      ctx.globalCompositeOperation = 'lighter';
      var LR = CONFIG.LANTERN_RADIUS * cam.zoom;
      var lg = ctx.createRadialGradient(ps.x, ps.y, 4, ps.x, ps.y, LR);
      lg.addColorStop(0,   'rgba(255,224,170,' + CONFIG.LANTERN_GLOW_ALPHA + ')');
      lg.addColorStop(0.5, 'rgba(255,206,140,' + (CONFIG.LANTERN_GLOW_ALPHA * 0.38) + ')');
      lg.addColorStop(1,   'rgba(255,190,120,0)');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(ps.x, ps.y, LR, 0, 6.2832); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    /* ── 8. ★ 채집물 반짝임 — 안개보다 위, 산소보다 아래 ──
       "귀환 경로에서 살짝 벗어난 곳에 가장 큰 보상"이 성립하려면
       보상이 보여야 우회 여부를 판단할 수 있다. 장식이 아니라 기능. */
    if (CONFIG.GLINT_ALPHA > 0.001) {
      var gspr = getGlintSprite();
      var cap = q === 0 ? 12 : (q === 1 ? 20 : 999), drawn = 0;
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < G.critters.length && drawn < cap; i++) {
        var cq = G.critters[i];
        if (cq.taken) continue;
        var gp = w2s(cam, cq.x, cq.y);
        if (gp.x < -70 || gp.x > W + 70 || gp.y < -70 || gp.y > H + 70) continue;
        var dark = depthRatio(cq.y);
        var pulse = 0.62 + 0.38 * Math.sin(T * 1.7 + cq.ph * 2.3);
        var ga = CONFIG.GLINT_ALPHA * (0.30 + 0.70 * cq.tier) * pulse * (0.15 + 0.85 * dark);
        if (ga < 0.004) continue;
        var gs = CONFIG.GLINT_RADIUS * (0.7 + 0.6 * cq.tier) * cam.zoom;
        ctx.globalAlpha = Math.min(1, ga);
        ctx.drawImage(gspr, gp.x - gs, gp.y - gs, gs*2, gs*2);
        drawn++;
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    /* ── 9~11. 산소 저하 ──────────────────────────────────
       ★ 수심은 화면 가장자리를 파랗게, 산소는 화면 전체의 색을 뺏는다.
         둘 다 가장자리를 어둡게 하면 구분이 안 되고,
         오히려 중심부가 밝아 보이는 동시대비가 생긴다.
         저산소에서 색각이 먼저 사라지는 것(grey-out)은 실제 현상이다. */
    var fail = clamp((0.62 - G.o2 / G.o2Max) / 0.62, 0, 1);
    if (fail > 0.001) {
      if (SUPPORTS_SAT && CONFIG.O2_DESAT > 0.001) {
        ctx.globalCompositeOperation = 'saturation';
        ctx.globalAlpha = fail * CONFIG.O2_DESAT;
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      if (CONFIG.O2_DARKEN > 0.001) {
        ctx.fillStyle = 'rgba(0,0,0,' + (fail * CONFIG.O2_DARKEN) + ')';
        ctx.fillRect(0, 0, W, H);
      }
      var vig = fail * CONFIG.VIGNETTE_MAX;
      if (vig > 0.001) {
        ctx.globalAlpha = vig;
        ctx.drawImage(getVignetteSprite(), 0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }

    /* 심박의 시각 대체 — 가장자리 펄스 (접근성) */
    if (G.o2 / G.o2Max * 100 < CONFIG.HEARTBEAT_START_PCT) {
      var hb = Math.max(0, Math.sin(T * 7.4));
      var hl = (1 - (G.o2 / G.o2Max * 100) / CONFIG.HEARTBEAT_START_PCT);
      ctx.globalAlpha = hb * hl * 0.30;
      ctx.strokeStyle = '#d8694f'; ctx.lineWidth = 14;
      ctx.strokeRect(7, 7, W - 14, H - 14);
      ctx.globalAlpha = 1;
    }

    /* ── 오프스크린 렌더 종료 — 메인 캔버스로 복귀 ── */
    ctx = mainCtx;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    /* ── 2) 하늘 / 먼바다 (근수면선 위) ── */
    drawSkyFar(cam, surf);

    /* ── 3) 오프스크린을 근수면선 아래로 클립 + 굴절 합성 ── */
    compositeUnderwater(cam, surf, wavePts);

    /* ★ 빛기둥 윗부분이 물결 골에서 잘려 보이지 않도록 물결선 기준으로 이어붙인다 */
    drawShaftSurfaceBlend(cam, G, B, surf, q);

    /* ── 4) 수면선 자체 (포말 + 발광) ── */
    drawWaterline(cam, surf, wavePts);

    /* ★ 수면 근처에서 물결선 기준 그라디언트로 자연스럽게 이어붙인다 (끊김 없음) */
    drawDiverSurfaceBlend(cam, G, surf);

    /* 5) 동료 해녀 실루엣 — 수면 위에 떠 있으므로 합성 이후에 그려야
       물/굴절에 가리지 않는다. "혼자가 아니다"가 시각으로 전달되어야 한다.
       ★ 해녀(플레이어) 본인은 이미 1)의 오프스크린 렌더에 포함되어 있다. */
    drawAllies(cam, surf);

    /* ── 6) 수면이 화면 밖일 때 상단 방향 힌트 띠 (기존 조명 명세 유지) ──
       가로 화면에서 수면이 프레임 밖으로 나가는 문제를 해결한다 */
    if (surf < 0) {
      var hg = ctx.createLinearGradient(0, 0, 0, 46);
      hg.addColorStop(0, 'rgba(180,226,255,' + (0.34 * (1 - pd * 0.55)) + ')');
      hg.addColorStop(1, 'rgba(180,226,255,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, W, 46);
    }

    /* 수면 통과 띠 (부품 3) */
    var band = FX.bandOf();
    if (band) {
      var bt = band.t / band.dur;
      var by = band.dir > 0 ? lerp(-90, H + 90, bt) : lerp(H + 90, -90, bt);
      var bg = ctx.createLinearGradient(0, by - 70, 0, by + 70);
      bg.addColorStop(0,   'rgba(240,252,255,0)');
      bg.addColorStop(0.5, 'rgba(240,252,255,' + (0.5 * Math.sin(bt * Math.PI)) + ')');
      bg.addColorStop(1,   'rgba(240,252,255,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, by - 70, W, 140);
    }

    /* 물숨 라인 안내 — 게이지를 껐을 때도 읽혀야 한다 */
    if (G.mulsum) {
      ctx.fillStyle = 'rgba(232,168,88,0.10)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* 심해 색 소실 — 픽셀 조작이 아니라 값 계산 + 오버레이
     (file:// 캔버스는 tainted 라 getImageData 를 쓸 수 없습니다)
     ★ 랜턴은 밝히는 도구가 아니라 색을 되돌리는 도구.
       어둠은 그대로 두고 정보만 돌려주므로 밝기(LANTERN_GLOW_ALPHA)와
       색 복원 반경(LANTERN_COLOR_RADIUS)이 분리되어 있습니다. */
  function applyColorLoss(col, x, y, B, G, P) {
    if (B.colorLossFromM > 90) return col;
    var dm = y / CONFIG.PIXELS_PER_METER;
    var loss = clamp((dm - B.colorLossFromM) / Math.max(1, B.depthM - B.colorLossFromM), 0, 1);
    if (loss <= 0) return col;
    if (G.lanternOn) {
      var dist = Math.hypot(x - P.x, y - P.y);
      if (dist < CONFIG.LANTERN_COLOR_RADIUS) {
        loss *= clamp(dist / CONFIG.LANTERN_COLOR_RADIUS, 0, 1) * 0.35;
      }
    }
    var lum = grayOf(col);
    return mixC(col, [lum, lum, lum], loss);
  }

  /* 감태 — assets/img/gamtae.png (뿌리=이미지 하단 중앙 기준).
     ★ 좌우로 흔들리는 애니메이션은 그대로 유지한다: 원래 절차적 그림은
     세그먼트마다 흔들림이 누적되는 방식이었지만, 통짜 이미지는 구부러질
     수 없으므로 뿌리를 축으로 한 회전으로 근사한다. 흔들림 진폭(팁 기준
     좌우 15px)은 원래 수치를 그대로 가져와 회전각으로 환산했다
     (atan2(15, k.h) — 키가 작을수록 더 크게, 클수록 더 작게 기울어져
     "끝이 15px쯤 흔들린다"는 원래 느낌을 유지한다).
     이미지가 없으면(로드 실패) 기존 절차적 선 그림으로 자동 폴백된다. */
  function drawKelp(G, viewL, viewR, front) {
    ctx.lineCap = 'round';
    var img = SPRITES['gamtae'];
    for (var i = 0; i < G.kelps.length; i++) {
      var k = G.kelps[i];
      if (k.front !== front || k.x < viewL - 60 || k.x > viewR + 60) continue;

      if (img) {
        var sway = Math.sin(T * 0.9 + k.ph) * Math.atan2(15, k.h);
        var kw = k.h * (img.width / img.height);
        ctx.save();
        ctx.globalAlpha = front ? 0.92 : 0.72;
        ctx.translate(k.x, k.y);
        ctx.rotate(sway);
        ctx.drawImage(img, -kw / 2, -k.h, kw, k.h);
        ctx.restore();
        continue;
      }

      ctx.strokeStyle = front ? 'rgba(16,42,36,0.92)' : 'rgba(22,52,44,0.72)';
      ctx.lineWidth = k.w;
      ctx.beginPath();
      ctx.moveTo(k.x, k.y);
      for (var seg = 1; seg <= 5; seg++) {
        var f = seg / 5;
        ctx.lineTo(k.x + Math.sin(T * 0.9 + k.ph + f * 2.2) * 15 * f, k.y - k.h * f);
      }
      ctx.stroke();
      /* 잎 */
      ctx.lineWidth = k.w * 2.6;
      ctx.globalAlpha = 0.55;
      for (var lf = 1; lf <= 3; lf++) {
        var ff = lf / 3.6;
        var lx = k.x + Math.sin(T * 0.9 + k.ph + ff * 2.2) * 15 * ff;
        var ly = k.y - k.h * ff;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx + (lf % 2 ? 1 : -1) * k.h * 0.13, ly - k.h * 0.09);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* 동료 해녀 실루엣 2~3명 — 출수 연출에서 드러난다 */
  function drawAllies(cam, surf) {
    var ax = [CONFIG.TEWAK_X - 210, CONFIG.TEWAK_X + 250, CONFIG.TEWAK_X + 430];
    for (var i = 0; i < ax.length; i++) {
      var p = w2s(cam, ax[i], 0);
      if (p.x < -60 || p.x > W + 60) continue;
      var s = 26 * cam.zoom;
      var bobY = Math.sin(T * 1.1 + i * 2.1) * 3 * cam.zoom;
      ctx.fillStyle = 'rgba(226,234,236,0.85)';
      ctx.beginPath(); ctx.arc(p.x, p.y - s*0.1 + bobY, s*0.42, 0, 6.2832); ctx.fill();
      ctx.fillStyle = rgba(COL.ally, 0.9);
      ctx.beginPath(); ctx.arc(p.x + s*0.34, p.y - s*0.42 + bobY, s*0.22, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(16,28,36,0.55)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y + s*0.16 + bobY, s*0.5, s*0.16, 0, 0, 6.2832); ctx.fill();
    }
  }

  /* 실패 3단계 — 동료 해녀가 아래에서 올라와 끌고 상승 */
  function drawRescue(G) {
    var R = G.rescue;
    if (R.t < 0.4) return;
    var h = H * CONFIG.CHAR_HEIGHT_PCT;
    ctx.save();
    ctx.translate(G.player.x - h * 0.55, G.player.y + h * 0.28);
    ctx.globalAlpha = clamp((R.t - 0.4) * 2, 0, 1);
    var fake = { x:0, y:0, ang:-Math.PI/2 };
    /* ★ 헤엄치지 않고 수직으로 끌려 올라가는 자세 — standing:true 로 팔을 180도 돌려 아래로 향하게 한다 */
    drawDiver(ctx, fake, h, 0.1, T * 9, 0.5, 0, false, 'rgba(14,26,32,0.94)', 0, true);
    ctx.globalAlpha = 1;
    ctx.restore();
  }


  /* ============================================================
     타이틀 배경
     ============================================================ */
  function drawTitle(dtRaw) {
    T += dtRaw;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    /* ★ 해가 뜨려는 새벽 — 위쪽은 아직 밤의 남색이 남아 있고, 수평선 바로
       위에만 해가 곧 오를 자리의 노을빛이 얇게 걸려 있다(해는 아직 안 보인다) */
    var horizon = 352;
    var sg = ctx.createLinearGradient(0, 0, 0, horizon);
    sg.addColorStop(0, '#0f2434');
    sg.addColorStop(0.55, '#254b60');
    sg.addColorStop(0.84, '#a3643f');
    sg.addColorStop(1, '#f0a862');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, horizon);

    /* 한라산 실루엣 */
    ctx.fillStyle = 'rgba(24,44,52,0.55)';
    ctx.beginPath();
    ctx.moveTo(-40, horizon);
    ctx.quadraticCurveTo(W*0.30, horizon - 128, W*0.66, horizon);
    ctx.closePath(); ctx.fill();

    /* 바다 — 아직 어둡지만 수면 맨 위는 새벽빛을 옅게 반사한다 */
    var wg = ctx.createLinearGradient(0, horizon, 0, H);
    wg.addColorStop(0, '#5a6f68');
    wg.addColorStop(0.12, '#2e5c68');
    wg.addColorStop(1, '#0d2634');
    ctx.fillStyle = wg; ctx.fillRect(0, horizon, W, H - horizon);

    /* 파도 레이어 */
    for (var L = 0; L < 4; L++) {
      var y0 = horizon + 18 + L * 52;
      var amp = 4 + L * 3.2, sp = 0.5 + L * 0.28, k = 0.011 + L * 0.0032;
      ctx.fillStyle = 'rgba(190,226,232,' + (0.05 + L * 0.035) + ')';
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (var x = 0; x <= W; x += 10) ctx.lineTo(x, y0 + Math.sin(x*k + T*sp + L)*amp);
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    }
    /* 테왁 + 동료 */
    for (var t2 = 0; t2 < 3; t2++) {
      var tx = 150 + t2 * 300, ty = horizon + 74 + Math.sin(T*1.2 + t2)*5;
      ctx.fillStyle = 'rgba(236,242,240,0.88)';
      ctx.beginPath(); ctx.arc(tx, ty, 13, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(224,122,60,0.85)';
      ctx.beginPath(); ctx.arc(tx, ty, 5, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(16,28,36,0.72)';
      ctx.beginPath(); ctx.arc(tx + 20, ty - 6, 7, 0, 6.2832); ctx.fill();
    }
    /* 아래쪽 어둡게 — 버튼 가독성 */
    var vg2 = ctx.createLinearGradient(0, H*0.3, 0, H);
    vg2.addColorStop(0, 'rgba(6,12,16,0)');
    vg2.addColorStop(1, 'rgba(6,12,16,0.62)');
    ctx.fillStyle = vg2; ctx.fillRect(0, 0, W, H);
  }


  /* ============================================================
     불턱 — 살림 레이어 3장 토글이 전부입니다.
     ★ 사면 영원히 그 자리에 놓입니다. 방 자체가 진행도이므로
       별도 진행도 UI 를 만들지 마세요.
     ============================================================ */
  function drawBulteok(dtRaw) {
    T += dtRaw;
    if (glance.t > 0) glance.t = Math.max(0, glance.t - dtRaw);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    var warm = PROGRESS.home.pot ? 1 : 0;          /* 솥을 사면 불턱이 따뜻해진다 */
    /* ★ 잠수 이력 기준 분기 — 최초 접속(한 번도 안 들어감)은 밝은 아침,
       한 번이라도 잠수하고 돌아오면 그 뒤로는 계속 노을(횟수 무관, 되돌아가지 않는다) */
    var morning = PROGRESS.stat.dives === 0 ? 1 : 0;
    /* 레이아웃 — 오른쪽(장비 패널)과 아래(바당 카드)를 비워 둔다.
       씬이 쓰는 영역은 x 0~450 / y 46~460 */
    var horizon = 168, ground = 262;

    /* 하늘 — 최초 접속(잠수 이력 없음)은 맑고 밝은 아침, 잠수를 한 번이라도
       다녀오면 그 뒤로는 계속 노을(다시 아침으로 안 돌아간다) */
    var sg = ctx.createLinearGradient(0, 0, 0, horizon);
    if (morning) { sg.addColorStop(0, '#3f7fa8'); sg.addColorStop(0.6, '#9fd2df'); sg.addColorStop(1, '#fdf1d2'); }
    else         { sg.addColorStop(0, '#2b3f57'); sg.addColorStop(0.55, '#a2543a'); sg.addColorStop(1, '#f0a15c'); }
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, horizon);

    /* 바다 */
    var wg = ctx.createLinearGradient(0, horizon, 0, ground);
    if (morning) { wg.addColorStop(0, '#8fbcc2'); wg.addColorStop(1, '#4a6d74'); }
    else         { wg.addColorStop(0, '#8a5f4c'); wg.addColorStop(1, '#3b4348'); }
    ctx.fillStyle = wg; ctx.fillRect(0, horizon, W, ground - horizon);
    ctx.strokeStyle = morning ? 'rgba(230,250,252,0.32)' : 'rgba(240,180,120,0.28)';
    ctx.lineWidth = 1.4;
    for (var L = 0; L < 4; L++) {
      var y0 = horizon + 14 + L * 22;
      ctx.beginPath();
      for (var x = 0; x <= W; x += 12) ctx.lineTo(x, y0 + Math.sin(x*0.014 + T*0.5 + L)*3);
      ctx.stroke();
    }

    /* 땅 (현무암) — 물가에서 육지로 */
    var gg = ctx.createLinearGradient(0, ground - 14, 0, H);
    gg.addColorStop(0, morning ? '#4a453a' : '#4a3324');
    gg.addColorStop(1, morning ? '#221f18' : '#1f150e');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.moveTo(0, ground + 6);
    for (var gx = 0; gx <= W; gx += 30) ctx.lineTo(gx, ground - 6 + Math.sin(gx * 0.021) * 7);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

    /* ── 돌담 너머 언덕 + 우리 집 ──────────────────────────
       ★ 불턱은 옷 갈아입고 몸 녹이는 공동 공간이라 개인 세간(솥·책)이
         놓일 자리가 아닙니다. 살림은 전부 "멀리 보이는 집의 변화"로만
         드러납니다 — 굴뚝 연기(솥) / 창 불빛(책) / 이랑 있는 밭(밭).
       ★ 집은 구매 여부와 무관하게 처음부터 항상 보입니다.
         플레이스홀더를 따로 그리지 않습니다 — 집 자체가 플레이스홀더입니다. */
    var hs = HOME_BY_ID.pot;                    /* 집 핫스팟 사각형과 같은 자리 */
    var hxC = hs.hx + hs.hw / 2;                /* 집 중심 x */
    var hBase = hs.hy + hs.hh;                  /* 집이 앉은 바닥 y */

    /* ★ 아트 교체 슬롯 — assets/img/bulteok.svg(또는 .png).
       언덕 + 돌담(바람막이) + 화덕 자리(불꽃 제외)를 하나로 합친 배경 한 장.
       캔버스 절대좌표 x0~460,y300~600 을 그대로 그린 그림이라 변환 없이
       (0,300)에 얹는다 — 화면 왼쪽 절반(장비 패널이 있는 오른쪽은 비움).
       화덕 불꽃/연기/불빛은 애니메이션이라 이 아트와 무관하게 계속
       코드로 그린다(아래 "화덕 + 불" 참고). 조각이 없으면 기존 벡터
       도형으로 자동 폴백된다. */
    var hasBulteokArt = !!SPRITES['bulteok'];
    if (hasBulteokArt) {
      ctx.drawImage(SPRITES['bulteok'], 0, 300, 460, 300);
    } else {
      /* 언덕 — 집과 밭이 땅 위에 얹혀 보이도록 완만한 둔덕 하나 */
      ctx.fillStyle = morning ? '#354a52' : '#2f2d28';
      ctx.beginPath();
      ctx.moveTo(hxC - 150, hBase + 30);
      ctx.quadraticCurveTo(hxC - 40, hBase - 26, hxC + 70, hBase - 20);
      ctx.quadraticCurveTo(hxC + 190, hBase - 12, hxC + 300, hBase + 30);
      ctx.closePath(); ctx.fill();
    }

    /* 집 — 제주 단층 초가. 밤이라 어두운 실루엣이지만, 실루엣만으로는
       "집"이 안 읽혀서 지붕/벽 명도를 갈라두고 처마선만 얇게 넣는다.
       ★ 지붕은 낮고 넓은 둥근 초가여야 한다 — 뾰족하게 올리면 종처럼 보인다. */
    var hw2 = hs.hw * 0.5;
    var wallTop = hBase - hs.hh * 0.40;          /* 벽은 아래 40% */
    var eaveY = wallTop + 2;                      /* 처마 높이 */
    var roofTop = hs.hy + 6;

    /* ★ 아트 교체 슬롯 — assets/img/home_house.svg(또는 .png).
       굴뚝 끝(chTop)부터 집 바닥(hBase)까지, hs.hx~hs.hw 폭 그대로.
       굴뚝 연기/창 불빛은 애니메이션이라 이 아트와 무관하게 계속
       chX/chTop, winX/winY 기준으로 코드가 그린다(그 아래 참고). */
    if (SPRITES['home_house']) {
      var houseArtY = roofTop - 9, houseArtH = hBase - houseArtY;
      ctx.drawImage(SPRITES['home_house'], hs.hx, houseArtY, hs.hw, houseArtH);
    } else {
      /* 초가지붕 — 처마가 벽보다 넓게 나온다 */
      ctx.fillStyle = morning ? '#8a7350' : '#5a4c3a';
      ctx.beginPath();
      ctx.moveTo(hxC - hw2, eaveY);
      ctx.bezierCurveTo(hxC - hw2 * 0.86, roofTop, hxC + hw2 * 0.86, roofTop, hxC + hw2, eaveY);
      ctx.closePath(); ctx.fill();
      /* 용마루 — 지붕 꼭대기를 한 줄 밝게 해서 둥근 볼륨이 읽히게 */
      ctx.strokeStyle = morning ? 'rgba(255,255,255,0.42)' : 'rgba(232,204,158,0.40)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(hxC - hw2 * 0.46, roofTop + 5.5);
      ctx.quadraticCurveTo(hxC, roofTop + 1.5, hxC + hw2 * 0.46, roofTop + 5.5);
      ctx.stroke();
      /* 처마 그림자 — 지붕과 벽을 갈라준다 */
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(hxC - hw2 * 0.98, eaveY); ctx.lineTo(hxC + hw2 * 0.98, eaveY); ctx.stroke();

      /* 벽 — 지붕보다 어둡게 */
      ctx.fillStyle = morning ? '#5c5142' : '#3a352d';
      ctx.fillRect(hxC - hw2 * 0.80, eaveY, hw2 * 1.60, hBase - eaveY);
      /* 문 — 작은 사각 하나면 "사람이 사는 집"이 읽힌다 */
      ctx.fillStyle = morning ? '#2e2822' : '#241f1a';
      ctx.fillRect(hxC + hw2 * 0.10, hBase - (hBase - eaveY) * 0.72, hw2 * 0.34, (hBase - eaveY) * 0.72);
    }

    /* 굴뚝 위치 — home_house 아트에 굴뚝이 이미 포함돼 있으므로, 몸체는
       아트가 없을 때만 그린다. chX/chTop 은 연기 애니메이션 기준점이라
       아트 유무와 무관하게 항상 계산해 둔다. */
    var chX = hxC - hw2 * 0.56, chTop = roofTop - 9;
    if (!SPRITES['home_house']) {
      ctx.fillStyle = morning ? '#5c5142' : '#3a352d';
      ctx.fillRect(chX - 4, chTop, 8, 22);
    }

    /* 살림 1: 무쇠솥 → 굴뚝에서 연기가 오른다 */
    if (PROGRESS.home.pot) {
      ctx.strokeStyle = 'rgba(214,228,232,0.20)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (var sm = 0; sm < 2; sm++) {
        ctx.beginPath();
        for (var sy3 = 0; sy3 <= 34; sy3 += 5) {
          var swy = Math.sin(T * 0.9 + sy3 * 0.14 + sm * 1.7) * (2.2 + sy3 * 0.10);
          ctx.lineTo(chX + swy + sm * 2, chTop - sy3);
        }
        ctx.globalAlpha = 0.9 - sm * 0.35;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    /* 살림 2: 아이 책값 → 창에 등잔 불빛이 켜진다 */
    if (PROGRESS.home.books) {
      var winX = hxC - hw2 * 0.36, winY = eaveY + (hBase - eaveY) * 0.42;
      var lampFlick = 0.86 + 0.14 * Math.sin(T * 3.1) * Math.sin(T * 1.7);
      ctx.fillStyle = 'rgba(255,206,132,' + (0.86 * lampFlick) + ')';
      ctx.fillRect(winX - 7, winY - 6, 14, 13);
      ctx.globalCompositeOperation = 'lighter';
      var wgl = ctx.createRadialGradient(winX, winY, 1, winX, winY, 46);
      wgl.addColorStop(0, 'rgba(255,198,120,' + (0.22 * lampFlick) + ')');
      wgl.addColorStop(1, 'rgba(255,198,120,0)');
      ctx.fillStyle = wgl;
      ctx.beginPath(); ctx.arc(winX, winY, 46, 0, 6.2832); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    /* ── 살림 3: 밭 한 뙈기 (집 옆 묵정밭) ──
       원근이 있는 사다리꼴 한 뙈기. 사기 전엔 잡풀만, 사고 나면 이랑이 선다. */
    var f = HOME_BY_ID.field;
    var fT = f.hy + 8, fB = f.hy + f.hh;                 /* 밭 위/아래 변 */
    function fieldPath() {
      ctx.beginPath();
      ctx.moveTo(f.hx - 10, fB);
      ctx.lineTo(f.hx + f.hw + 10, fB);
      ctx.lineTo(f.hx + f.hw - 12, fT);
      ctx.lineTo(f.hx + 12, fT);
      ctx.closePath();
    }
    /* ★ 아트 교체 슬롯 — assets/img/home_field.svg(또는 .png).
       "밭을 산 뒤(이랑 있는 상태)"만 이 아트로 그린다 — 사기 전 묵정밭은
       내용이 단순해서 계속 절차적으로 그린다(파일 하나를 아낀다). */
    if (PROGRESS.home.field && SPRITES['home_field']) {
      ctx.drawImage(SPRITES['home_field'], f.hx - 10, fT, f.hw + 20, fB - fT);
    } else {
      /* 흙바닥 */
      ctx.fillStyle = PROGRESS.home.field
        ? (morning ? '#5c4a34' : '#4a3b28')
        : (morning ? '#3d3c32' : '#33322b');
      fieldPath(); ctx.fill();
      /* 돌담 테두리 — 제주 밭은 돌담으로 구획된다. 얇게 한 줄이면 충분 */
      ctx.strokeStyle = morning ? 'rgba(220,232,236,0.32)' : 'rgba(196,184,158,0.30)';
      ctx.lineWidth = 1.4;
      fieldPath(); ctx.stroke();

      if (PROGRESS.home.field) {
        /* 이랑 — 원근에 맞춰 아래로 갈수록 넓어진다 */
        ctx.strokeStyle = morning ? 'rgba(170,196,130,0.85)' : 'rgba(154,178,110,0.85)';
        ctx.lineWidth = 2.2;
        for (var rr = 0; rr < 4; rr++) {
          var t2 = (rr + 1) / 5;
          var yy = fT + (fB - fT) * t2;
          var inset = 12 * (1 - t2) - 10 * t2;
          ctx.beginPath();
          ctx.moveTo(f.hx + inset, yy);
          ctx.lineTo(f.hx + f.hw - inset, yy);
          ctx.stroke();
        }
      } else {
        /* 묵정밭 — 임자 없는 땅. 잡풀만 삐죽삐죽 */
        ctx.strokeStyle = morning ? 'rgba(140,144,124,0.45)' : 'rgba(120,124,104,0.45)';
        ctx.lineWidth = 1;
        for (var wd = 0; wd < 10; wd++) {
          var t3 = (wd % 5) / 4;
          var wy2 = fT + 6 + (fB - fT - 10) * ((wd < 5) ? 0.30 : 0.74);
          var wx = f.hx + 16 + t3 * (f.hw - 32) + (wd < 5 ? 0 : 8);
          ctx.beginPath(); ctx.moveTo(wx, wy2); ctx.lineTo(wx + 2.5, wy2 - 9); ctx.stroke();
        }
      }
    }

    /* ── 불턱 돌담 (현무암을 쌓아 만든 바람막이) ── bulteok 아트에
       이미 포함되어 있으므로 아트가 없을 때만 그린다.
       ★ 왼쪽은 트여 있습니다. 그 너머가 묵정밭 자리입니다. */
    var cx = 258, cy = 452, rx = 196, ry = 98;
    if (!hasBulteokArt) {
      var stones = [];
      for (var s2 = 0; s2 < 40; s2++) {
        var a2 = Math.PI * (1.06 + (s2 % 20) / 19 * 0.88);   /* 왼쪽 끝을 조금 비운다 */
        var ring = s2 < 20 ? 1.0 : 0.80;
        var stx = cx + Math.cos(a2) * rx * ring;
        var sty = cy + Math.sin(a2) * ry * ring + (s2 < 20 ? 0 : 22);
        stones.push({ x: stx, y: sty, r: 13 + (s2 % 4) * 3.5, i: s2 });
      }
      stones.sort(function (a, b) { return a.y - b.y; });     /* 뒤쪽부터 */
      for (var k2 = 0; k2 < stones.length; k2++) {
        var st2 = stones[k2], sr = st2.r;
        var base = morning ? 74 : 58;
        ctx.fillStyle = 'rgb(' + (base + (st2.i%5)*4) + ',' + (base + 3 + (st2.i%3)*4) + ',' + (base + 6 + (st2.i%4)*3) + ')';
        ctx.beginPath(); ctx.ellipse(st2.x, st2.y, sr, sr*0.78, st2.i*0.7, 0, 6.2832); ctx.fill();
        /* 젖은 윗면 하이라이트 — 불빛을 받는다 */
        ctx.fillStyle = 'rgba(206,170,120,' + (0.05 + warm * 0.04) + ')';
        ctx.beginPath(); ctx.ellipse(st2.x + sr*0.1, st2.y - sr*0.30, sr*0.62, sr*0.24, 0, 0, 6.2832); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.34)';
        ctx.beginPath(); ctx.ellipse(st2.x - sr*0.15, st2.y + sr*0.34, sr*0.72, sr*0.22, 0, 0, 6.2832); ctx.fill();
      }
    }

    /* ── 화덕 + 불 ── 화덕 구덩이·장작은 정적이라 아트에 포함되지만,
       불빛/불꽃은 매 프레임 흔들리는 애니메이션이라 아트 유무와 무관하게
       항상 그린다. */
    var fx2 = 244, fy2 = 400;
    if (!hasBulteokArt) {
      ctx.fillStyle = '#131618';
      ctx.beginPath(); ctx.ellipse(fx2, fy2 + 16, 48, 15, 0, 0, 6.2832); ctx.fill();
    }
    var flick = 0.78 + 0.22 * Math.sin(T * 7.1) * Math.sin(T * 3.3);
    /* 불빛 광원 — 은은하게. 너무 밝으면 현무암이 회색 덩어리로 뭉개진다 */
    ctx.globalCompositeOperation = 'lighter';
    var glowR = 168 * flick;
    var flg = ctx.createRadialGradient(fx2, fy2, 4, fx2, fy2, glowR);
    flg.addColorStop(0,   'rgba(255,176,86,' + (0.16 + warm * 0.07) + ')');
    flg.addColorStop(0.38,'rgba(226,126,54,0.055)');
    flg.addColorStop(1,   'rgba(200,100,40,0)');
    ctx.fillStyle = flg;
    ctx.beginPath(); ctx.arc(fx2, fy2, glowR, 0, 6.2832); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    /* 장작 */
    if (!hasBulteokArt) {
      ctx.strokeStyle = '#463228'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(fx2-30, fy2+14); ctx.lineTo(fx2+26, fy2+4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx2-24, fy2+2); ctx.lineTo(fx2+30, fy2+14); ctx.stroke();
    }
    /* 불꽃 */
    for (var fl = 0; fl < 5; fl++) {
      var fh = (34 + fl * 9) * flick;
      var fo = Math.sin(T * (4 + fl) + fl) * 6;
      ctx.fillStyle = fl < 2 ? 'rgba(255,232,160,0.95)' : 'rgba(232,132,52,0.72)';
      ctx.beginPath();
      ctx.moveTo(fx2 - 16 + fl*8, fy2 + 8);
      ctx.quadraticCurveTo(fx2 - 12 + fl*8 + fo, fy2 - fh*0.5, fx2 - 8 + fl*8 + fo*0.4, fy2 - fh);
      ctx.quadraticCurveTo(fx2 - 2 + fl*8 + fo, fy2 - fh*0.4, fx2 - 6 + fl*8, fy2 + 8);
      ctx.closePath(); ctx.fill();
    }

    /* ★ 솥·책은 여기(불턱 안)에 그리지 않습니다 — 위쪽 "우리 집"의
       굴뚝 연기 / 창 불빛으로만 드러납니다. */

    /* 불 앞에 앉은 동료 해녀 — 해녀는 혼자 물질하지 않는다.
       al===1 이 "말하는" 동료다 (allyHeadPos 가 가리키는 바로 그 머리).
       살림 자리가 막 hinted 로 넘어간 순간, 이 동료만 잠깐 그쪽을 바라본다. */
    for (var al = 0; al < 2; al++) {
      var ax2 = al ? 168 : 336, ay2 = 424 + al * 4;
      var headX = ax2 + (al ? 7 : -7), headY = ay2 - 15;
      var glanceOx = 0, glanceOy = 0;
      if (al === 1 && glance.t > 0) {
        var gp = 1 - glance.t / GLANCE_DUR;                    /* 0→1 */
        var gk = Math.sin(Math.PI * clamp(gp, 0, 1));           /* 0→1→0, 갔다가 돌아온다 */
        var gdx = glance.x - headX, gdy = glance.y - headY;
        var gdd = Math.hypot(gdx, gdy) || 1;
        glanceOx = gdx / gdd * 4 * gk; glanceOy = gdy / gdd * 3 * gk;
      }
      /* ★ 아트 교체 슬롯 — assets/img/home_diver.svg(또는 .png), 앉은 해녀
         한 명 기준 자세. 두 자리(al=0,1)에 같은 그림을 그대로 재사용한다.
         이미지 하단 중앙(가로 중심, 세로 끝)이 "앉은 자리"가 되도록
         그려두면 (ax2, ay2+42) 기준으로 자동 정렬된다.
         살짝 쳐다보는 연출(glanceOx/Oy)은 머리만이 아니라 그림 전체를
         살짝 미는 것으로 단순화했다. */
      var diverImg = SPRITES['home_diver'];
      if (diverImg) {
        var DW = 80, DH = 100;
        ctx.drawImage(diverImg, ax2 - DW / 2 + glanceOx, ay2 + 42 - DH + glanceOy, DW, DH);
      } else {
        ctx.fillStyle = 'rgba(10,14,16,0.92)';
        ctx.beginPath(); ctx.ellipse(ax2, ay2 + 16, 20, 26, 0, Math.PI, 0); ctx.fill();
        ctx.beginPath(); ctx.arc(headX + glanceOx, headY + glanceOy, 10.5, 0, 6.2832); ctx.fill();
      }
    }

    /* 오른쪽 패널 뒤 어둡게 — 장비 UI 가독성 */
    var rg = ctx.createLinearGradient(W*0.46, 0, W, 0);
    rg.addColorStop(0, 'rgba(6,10,13,0)');
    rg.addColorStop(1, 'rgba(6,10,13,0.74)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    /* 아래쪽 (바당 카드 뒤) 도 살짝 */
    var bgd2 = ctx.createLinearGradient(0, H*0.72, 0, H);
    bgd2.addColorStop(0, 'rgba(6,10,13,0)');
    bgd2.addColorStop(1, 'rgba(6,10,13,0.55)');
    ctx.fillStyle = bgd2; ctx.fillRect(0, 0, W, H);
    /* 따뜻한 색조 (솥 구매 후) */
    if (warm) {
      ctx.fillStyle = 'rgba(226,146,68,0.055)';
      ctx.fillRect(0, 0, W, H);
    }
  }


  /* ============================================================
     도감 — 첫 조우 프레임 캡처
     ★ toDataURL / getImageData 를 쓰지 않습니다.
       캔버스를 그대로 들고 있다가 drawImage 로 그립니다.
     ============================================================ */
  function capture(cam, worldX, worldY) {
    var c = document.createElement('canvas');
    c.width = 600; c.height = 396;
    var g = c.getContext('2d');
    var p = w2s(cam, worldX, worldY);
    var sw = 380, sh = sw * (396/600);
    var sx = clamp(p.x - sw/2, 0, W - sw);
    var sy = clamp(p.y - sh/2, 0, H - sh);
    g.drawImage(cv, sx*DPR, sy*DPR, sw*DPR, sh*DPR, 0, 0, 600, 396);
    return c;
  }

  /* 도감 카드용 아이콘 (미획득이면 실루엣) */
  function drawDexIcon(canvas, sp, locked) {
    var g = canvas.getContext('2d');
    g.setTransform(1,0,0,1,0,0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.save();
    g.translate(canvas.width/2, canvas.height/2);
    var col = locked ? [46, 60, 68] : sp.col;
    if (sp.kind === 'observe') {
      var s = Math.min(canvas.width / (sp.w * 1.25), canvas.height / (sp.h * 1.3));
      drawObserverShape(g, sp, s, col, 0, locked);
    } else {
      var k = Math.min(canvas.width, canvas.height) / (sp.r * 4.2);
      g.scale(k, k);
      /* ★ locked(미획득) 상태는 스포일러 방지를 위해 단색이지만, 실루엣 모양은
         실제 원본 PNG와 같아야 한다 — drawCritterLocked()가 tint()로 처리 */
      if (locked) drawCritterLocked(g, sp, sp.r, col);
      else drawCritter(g, sp, sp.r, col);
    }
    g.restore();
  }

  /* 도감 상세용 폴백 그림 (캡처가 없을 때) */
  function drawDexFallback(canvas, sp) {
    var g = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var bgd = g.createLinearGradient(0, 0, 0, h);
    var deep = depthRatio(((sp.minD + sp.maxD) / 2) * CONFIG.PIXELS_PER_METER);
    var top = mixC([104,172,186], COL.waterDeep, clamp(deep - 0.15, 0, 1));
    var bot = mixC([104,172,186], COL.waterDeep, clamp(deep + 0.15, 0, 1));
    bgd.addColorStop(0, rgb(top)); bgd.addColorStop(1, rgb(bot));
    g.fillStyle = bgd; g.fillRect(0, 0, w, h);
    /* 생물 */
    g.save(); g.translate(w*0.56, h*0.48);
    if (sp.kind === 'observe') drawObserverShape(g, sp, Math.min(w/(sp.w*1.7), 1.6), sp.col, 0);
    else { var k = 3.4; g.scale(k, k); drawCritter(g, sp, sp.r, sp.col); }
    g.restore();
    /* ★ 해녀 실루엣을 같이 넣어 크기 비교가 되게 한다 */
    var hh = h * 0.34;
    g.save(); g.translate(w*0.17, h*0.60);
    drawDiver(g, { x:0, y:0, ang:0 }, hh, 0.1, 1.2, 0.4, 0.2, false, 'rgba(10,20,26,0.92)');
    g.restore();
    /* 안개 */
    var fg = g.createRadialGradient(w*0.5, h*0.5, h*0.24, w*0.5, h*0.5, w*0.62);
    fg.addColorStop(0, rgba(COL.fog, 0)); fg.addColorStop(1, rgba(COL.fog, 0.6 * deep + 0.12));
    g.fillStyle = fg; g.fillRect(0, 0, w, h);
  }

  function clearCanvas() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#07090b';
    ctx.fillRect(0, 0, W, H);
  }

  return {
    init: init, resize: resize, preload: preload,
    drawDive: drawDive, drawTitle: drawTitle, drawBulteok: drawBulteok,
    capture: capture, drawDexIcon: drawDexIcon, drawDexFallback: drawDexFallback,
    clearCanvas: clearCanvas,
    depthRatio: depthRatio, w2s: w2s,
    SPRITES: SPRITES, tint: tint, COL: COL,
    SUPPORTS_SAT: SUPPORTS_SAT,
    allyHeadPos: allyHeadPos, triggerAllyGlance: triggerAllyGlance,
    invalidateShaft: function () { shaftSprite = null; },
    invalidateFog: function () { fogCache = null; },
    get ctx() { return ctx; },
    get canvas() { return cv; },
    get dpr() { return DPR; }
  };
})();
