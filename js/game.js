/* ============================================================
   숨비 (SUMBI) — game.js
   상태 머신 · 물리 · 산소 · 채집

   ★ 고정 타임스텝 + delta clamp.
     물리·산소는 dt(타임스케일 반영), 물때 타이머·산소 회복은 dtRaw.
   ★ 테왁 왕복 세이브. 비운 것은 안전, 손에 든 것만 손실.
   ★ 상승속도 = SPEED_ASCEND_BASE × (1 − weightRatio × WEIGHT_ASCEND_PENALTY)
   ============================================================ */
var SUMBI = SUMBI || {};

var GAME = (function () {

  var PPM = CONFIG.PIXELS_PER_METER;
  var GT = 0;   /* 채집 저항의 흔들림(wobble) 등에 쓰는 시간 누적. dt 로 늘어나므로 히트스톱에 함께 멈춘다 */
  function lerp(a,b,t){ return a+(b-a)*t; }
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function smoothstep(t){ return t*t*(3-2*t); }
  function rand(a,b){ return a + Math.random()*(b-a); }
  function randi(a,b){ return Math.floor(rand(a,b+1)); }

  /* 최단 방향 각도 접근 */
  function approachAngle(cur, target, maxStep) {
    var d = target - cur;
    while (d > Math.PI) d -= Math.PI*2;
    while (d < -Math.PI) d += Math.PI*2;
    if (Math.abs(d) <= maxStep) return target;
    return cur + Math.sign(d) * maxStep;
  }

  /* ============================================================
     상태
     ============================================================ */
  var G = {
    state: 'title',          /* title | bulteok | dive | dex */
    paused: false,
    badang: BADANG[0],

    player: { x: CONFIG.TEWAK_X, y: 0, vx:0, vy:0, ang:-Math.PI/2, angTarget:-Math.PI/2, curl:0, kick:0 },
    cam: { cx: CONFIG.TEWAK_X, cy: 120, zoom: 1, sx:0, sy:0, bias: CONFIG.CAM_BIAS_SHALLOW },

    o2: 100, o2Max: 100,
    bag: [], banked: [],
    bagW: 0, bagRatio: 0,
    weightMax: 10,

    tide: 150, tideMax: 150,
    tideEnding: 0,
    tidePaused: false,   /* ★ DEV 전용 — 디버그 패널에서만 켜진다. 타이머만 멈추고 나머지(이동·채집·관찰 3종 등장)는 그대로 진행된다 */

    critters: [], rocks: [], kelps: [], shafts: [], observers: [],
    /* harvest: target 물때당 채집 중인 개체. prog(0~1)·stage(1~3)가 3단계 저항의 진행 상태.
       t 는 "홀드 중"인지 여부(0 초과) 판정과 O2_DRAIN_HARVEST 게이트에 그대로 쓴다. */
    harvest: { target: null, t: 0, prog: 0, stage: 1 },
    flying: [],           /* 완료된 채집물이 망사리로 날아가는 중 (베지어) */
    hitstopT: 0,           /* ms. 이 값이 남아있는 동안 물리 프레임은 dt=0 으로 호출된다 */
    bagPopT: 0,             /* 망사리 팝 애니메이션 잔여 시간 */

    mulsum: false, mulsumFired: false,
    /* mulsumFired 는 물숨을 벗어나면 리셋된다(연출 1회용). 일지는 "이번 물때에
       한 번이라도 물숨에 들어갔는가"가 필요해서 별도로 남긴다. */
    mulsumEver: false,
    newDex: [],            /* 이번 물때에 처음 본 종 id — 일지에 쓴다 */
    firstBadangEntry: '',  /* 승급으로 막 해금된 바다에 이번이 첫 입수면 그 이름. 일지에 쓴다 */
    lanternOn: false,
    submerged: false,
    rescue: null,
    over: false,

    maxDepth: 0, dayEarn: 0, dayItems: {},
    bubbleT: 0
  };

  /* 파생 ------------------------------------------------------ */
  function depthM() { return Math.max(0, G.player.y / PPM); }
  function o2Ratio() { return clamp(G.o2 / G.o2Max, 0, 1); }
  function weightRatio() { return clamp(G.bagW / G.weightMax, 0, 1); }
  /* ★ 이 한 줄이 이 게임의 킬러 메커니즘입니다 */
  function ascendSpeed() { return STATS.ascendBase() * (1 - weightRatio() * STATS.ascendPenalty()); }
  function moveSpeed()   { return CONFIG.SPEED_HORIZONTAL * (1 - weightRatio() * CONFIG.WEIGHT_MOVE_PENALTY); }
  function descendSpeed(){ return CONFIG.SPEED_DESCEND; }
  function floorY() { return G.badang.depthM * PPM; }

  function recalcBag() {
    var w = 0;
    for (var i = 0; i < G.bag.length; i++) w += SPECIES_BY_ID[G.bag[i].id].weight;
    G.bagW = w;
    G.bagRatio = clamp(w / G.weightMax, 0, 1);
  }


  /* ============================================================
     스테이지 생성
     ★ 배치 규칙: 고가치일수록 테왁에서 먼 쪽.
       "귀환 경로에서 살짝 벗어난 곳에 가장 큰 보상을 둔다."
     ============================================================ */
  function generateStage(B) {
    G.critters.length = 0; G.rocks.length = 0;
    G.kelps.length = 0; G.shafts.length = 0; G.observers.length = 0;

    var fy = B.depthM * PPM, i;

    /* 이 바당에 나오는 채집물과 그 안에서의 가치 순위 */
    var pool = [], maxV = 0, wSum = 0;
    for (i = 0; i < SPECIES.length; i++) {
      var sp = SPECIES[i];
      if (sp.kind !== 'harvest' || !sp.spawnW || !sp.spawnW[B.id]) continue;
      pool.push(sp); wSum += sp.spawnW[B.id];
      if (sp.value > maxV) maxV = sp.value;
    }
    var minV = pool[0].value;
    for (i = 0; i < pool.length; i++) if (pool[i].value < minV) minV = pool[i].value;

    function pick() {
      var r = Math.random() * wSum, acc = 0;
      for (var j = 0; j < pool.length; j++) {
        acc += pool[j].spawnW[B.id];
        if (r <= acc) return pool[j];
      }
      return pool[pool.length - 1];
    }

    var n = randi(B.spawnMin, B.spawnMax);
    /* 테왁 기준 각 방향으로 실제 쓸 수 있는 폭 — 배치 거리를 늘릴 때
       WORLD_WIDTH 바깥으로 나가지 않도록 이 안에서만 넓힌다. */
    var roomLeft = CONFIG.TEWAK_X - 60;
    var roomRight = CONFIG.WORLD_WIDTH - 60 - CONFIG.TEWAK_X;
    /* ★ 바당별로 분포를 다르게 주고 싶을 때만 BADANG[].distNearFrac/distFarFrac 를
       쓴다 — 없으면 전역 CONFIG 값 그대로. (예: '여'는 테왁 근처 밀집을
       줄이려고 distNearFrac 을 올려둠, data.js 참고) */
    var distNearFrac = typeof B.distNearFrac === 'number' ? B.distNearFrac : CONFIG.CRITTER_DIST_NEAR_FRAC;
    var distFarFrac = typeof B.distFarFrac === 'number' ? B.distFarFrac : CONFIG.CRITTER_DIST_FAR_FRAC;
    /* ★ depthBiasPow — 이 바당 안에서 채집물을 종별 수심 구간(minD~maxD)의
       "아래쪽"으로 몰아줄 때만 쓴다. 1이면 그 구간 안에서 균등분포(기본).
       1보다 작을수록 깊은 쪽으로 쏠린다(예: 0.4 → 평균이 구간의 약 71% 지점).
       '여'는 바당 자체가 얕아서 테왁(수면)과 채집물 사이 하강 거리가 거의
       없어 보인다는 피드백으로 추가 — data.js 의 BADANG[1] 참고. */
    var depthBiasPow = typeof B.depthBiasPow === 'number' ? B.depthBiasPow : 1;

    for (i = 0; i < n; i++) {
      var s = pick();
      /* 가치 등급 0~1 — 배치 거리와 반짝임 세기에 함께 쓴다 */
      var vr = maxV > minV ? (s.value - minV) / (maxV - minV) : 0.5;
      /* ★ x = lerp(xNear, xFar, valueRank * 0.85) — 단, xNear/xFar 는 고정 px
         가 아니라 그 방향 room 에 대한 비율(CRITTER_DIST_NEAR_FRAC~FAR_FRAC)이다.
         고정 px 로 두면 WORLD_WIDTH 가 넓어져도(아래 WIDEN 참조) 채집물이
         테왁 근처 옛 범위에만 몰리고 넓어진 폭은 텅 비게 된다.
         고가치일수록 테왁에서 먼 쪽. 귀환 경로에서 살짝 벗어난 곳에 큰 보상.
         ★ 한 자리에 몰리지 않도록: 바위에 얹는 최종 위치 기준으로, 이미 놓인
         채집물과 CRITTER_MIN_DIST 보다 가깝거나 CRITTER_CLUSTER_RADIUS 안에
         CRITTER_CLUSTER_MAX 개가 이미 있으면 자리를 다시 뽑는다.
         ★ 후보 좌표가 아니라 바위 스냅까지 끝난 최종 좌표로 검사해야 한다 —
         작은 바위 하나에 여럿이 스냅되면 후보는 떨어져 있어도 실제로는
         겹칠 수 있기 때문. 계속 실패하면(자리가 좁다는 뜻) 도달 거리를
         CRITTER_SPAWN_WIDEN 만큼씩 넓혀가며 재시도한다 — 그래도 한 물때에
         나오는 채집물 수(spawnMin~spawnMax)는 그대로 유지된다. */
      var x, y, perch, extra = 0, tries = 0, placed = false, widenSteps = 0;
      while (!placed) {
        tries++;
        var side = Math.random() < 0.42 ? -1 : 1;
        var room = (side < 0 ? roomLeft : roomRight) - 10;
        var d = Math.min(lerp(room * distNearFrac, room * distFarFrac, vr * 0.85)
                          + rand(-CONFIG.CRITTER_DIST_JITTER, CONFIG.CRITTER_DIST_JITTER) + extra, room);
        var cx = clamp(CONFIG.TEWAK_X + side * d, 60, CONFIG.WORLD_WIDTH - 60);
        var loD = s.minD, hiD = Math.min(s.maxD, B.depthM - 0.4);
        var dt = depthBiasPow === 1 ? Math.random() : Math.pow(Math.random(), depthBiasPow);
        var cy = (loD + (hiD - loD) * dt) * PPM;

        /* 채집물은 물에 떠 있지 않고 바위에 붙어 있어야 한다.
           가까운 바위 윗면이 있으면 거기 얹고, 없으면 앉을 자리를 하나 만든다. */
        var cPerch = null, pd = 1e9;
        for (var rI = 0; rI < G.rocks.length; rI++) {
          var rk = G.rocks[rI];
          if (rk.layer !== 1) continue;
          var top = rk.y - rk.r * 0.60;
          if (Math.abs(rk.x - cx) > rk.r * 0.85) continue;
          var dd = Math.abs(top - cy);
          if (dd < 78 && dd < pd) { pd = dd; cPerch = rk; }
        }
        /* ★ snapY (바위에 얹은 최종 y) — 반드시 fy 와 다른 이름을 써야 한다.
           var 는 함수 스코프라, 여기서 fy 를 재선언하면 위쪽의 "바당 바닥 y"
           fy(= B.depthM*PPM)를 이 while 문이 끝난 뒤에도 덮어써 버려서,
           뒤이어 나오는 바위/감태 배치가 엉뚱하게 얕은(때로는 수면 위) 깊이를
           기준으로 삼게 되는 버그가 있었다 — 감태 끝이 수면 근처에서 사각으로
           잘려 보이던 현상의 실제 원인. */
        var fx = cx, snapY = cy;
        if (cPerch) {
          var off = clamp(cx - cPerch.x, -cPerch.r * 0.72, cPerch.r * 0.72);
          fx = cPerch.x + off;
          snapY = cPerch.y - Math.sqrt(Math.max(0, 1 - (off/cPerch.r)*(off/cPerch.r))) * cPerch.r * 0.60 - s.r * 0.5;
        }

        /* ★ 후보 자신의 이웃 수뿐 아니라, 후보를 추가했을 때 "이웃의 이웃 수"도
           CRITTER_CLUSTER_MAX 를 넘지 않는지 함께 봐야 한다. 후보만 보면
           통과하더라도, 이미 다른 이웃을 2개 가진 채집물 옆에 또 붙으면
           그 채집물 기준으로는 4개짜리 무리가 되어버리기 때문. */
        var tooClose = false, nearCount = 0, overCluster = false;
        for (var ci = 0; ci < G.critters.length; ci++) {
          var dist = Math.hypot(G.critters[ci].x - fx, G.critters[ci].y - snapY);
          if (dist < CONFIG.CRITTER_MIN_DIST) tooClose = true;
          if (dist < CONFIG.CRITTER_CLUSTER_RADIUS) {
            nearCount++;
            var ciNear = 0;
            for (var cj = 0; cj < G.critters.length; cj++) {
              if (cj === ci) continue;
              if (Math.hypot(G.critters[cj].x - G.critters[ci].x, G.critters[cj].y - G.critters[ci].y) < CONFIG.CRITTER_CLUSTER_RADIUS) ciNear++;
            }
            if (ciNear + 1 >= CONFIG.CRITTER_CLUSTER_MAX) overCluster = true;
          }
        }
        placed = !tooClose && !overCluster && nearCount + 1 <= CONFIG.CRITTER_CLUSTER_MAX;
        if (!placed && tries % CONFIG.CRITTER_SPAWN_TRIES === 0) {
          widenSteps++;
          extra += CONFIG.CRITTER_SPAWN_WIDEN;
          /* 도달 거리를 몇 번 늘려도 자리가 안 나면 — 이 바당 자체가 좁다는
             뜻이므로 WORLD_WIDTH 를 늘려 배치 구역 자체를 넓힌다. */
          if (widenSteps >= 3 && CONFIG.WORLD_WIDTH < CONFIG.WORLD_WIDTH_MAX) {
            CONFIG.WORLD_WIDTH = Math.min(CONFIG.WORLD_WIDTH_MAX, CONFIG.WORLD_WIDTH + CONFIG.WORLD_WIDTH_STEP);
            roomRight = CONFIG.WORLD_WIDTH - 60 - CONFIG.TEWAK_X;
            extra = 0; widenSteps = 0;
          }
        }
        if (tries > CONFIG.CRITTER_SPAWN_TRIES * 20) placed = true;   /* 안전장치 — 자리가 끝내 안 나도 개수는 채운다 */

        if (placed) { x = fx; y = snapY; perch = cPerch; }
      }

      if (!perch) {
        /* 앉을 바위를 그 자리에 만든다 — 보상 주위로 암초가 자라난다 */
        G.rocks.push({
          layer: 1, x: x + rand(-8, 8), y: y + s.r * 0.9 + rand(10, 26),
          r: rand(20, 38), rot: rand(-0.35, 0.35), seed: Math.random() * 100
        });
      }

      G.critters.push({
        id: s.id, x: x, y: y, taken: false,
        ph: Math.random() * 6.28, rot: rand(-0.4, 0.4),
        tier: vr,
        occluded: B.kelp > 0 && Math.random() < 0.55,
        attempts: 0,   /* ★ 채집 저항 재시도 페널티에 쓰인다 */
        /* ★ 전부 바위 위에 얹힌 것처럼 보이지 않도록 — 70%는 아랫부분이
           작은 바위 조각(진짜 바위와 같은 rockPath 실루엣)에 가려진 것처럼
           그린다. coverSeed/coverRot 은 그 조각의 들쭉날쭉한 모양이 매
           프레임 바뀌지 않도록 생성 시점에 고정해 둔다. render.js 참고. */
        behindRock: Math.random() < 0.7,
        coverSeed: Math.random() * 100, coverRot: rand(-0.3, 0.3)
      });
    }

    /* 바위 — 물에 뜬 덩어리가 아니라 바닥에서 솟은 암초여야 한다.
       원경(layer 0)은 크고 흐리게, 근경(layer 1)은 바닥에 뿌리내린다. */
    for (i = 0; i < 34; i++) {
      var far = i < 13;
      var rr = far ? rand(52, 118) : rand(24, 74);
      /* 대부분 바닥에 붙이고, 일부만 중층 암반 턱으로 올린다 */
      var ry2 = Math.random() < 0.76
        ? fy - rand(-24, rr * 0.55)
        : rand(fy * 0.34, fy * 0.86);
      G.rocks.push({
        layer: far ? 0 : 1,
        x: rand(-80, CONFIG.WORLD_WIDTH + 80),
        y: ry2,
        r: rr,
        rot: rand(-0.35, 0.35),
        seed: Math.random() * 100
      });
    }

    /* 감태 — 가리기만 한다. 길찾기 금지.
       ★ 높이 범위를 절차적 선 그림 시절(90~280)보다 낮췄다 — 실제 그림
       (assets/img/gamtae.png)은 폭이 있는 잎사귀라 가는 선보다 부피감이
       커서, 같은 높이면 훨씬 더 커 보인다(render.js drawKelp 참고). */
    for (i = 0; i < B.kelp; i++) {
      var kh = rand(70, 190);
      G.kelps.push({
        x: rand(20, CONFIG.WORLD_WIDTH - 20),
        y: rand(fy * 0.45, fy + 6),
        h: kh, w: rand(4, 9),
        ph: Math.random() * 6.28,
        front: Math.random() < 0.45
      });
    }

    /* 빛기둥 */
    var sc = B.shaftCount;
    for (i = 0; i < sc; i++) {
      G.shafts.push({
        x: CONFIG.TEWAK_X + rand(-260, 520),
        tilt: rand(-0.16, 0.16),
        sp: rand(0.45, 1.0),      /* 0.25 이하면 한 사이클이 20초를 넘어 멈춘 것처럼 보인다 */
        ph: Math.random() * 6.28
      });
    }

    /* ★ 관찰 3종 — 물때당 1회 확정 출현.
       승급 조건이므로 랜덤으로 안 나오면 진행이 막힌다. */
    for (i = 0; i < SPECIES.length; i++) {
      var ob = SPECIES[i];
      if (ob.kind !== 'observe' || ob.badang !== B.id) continue;
      G.observers.push({
        id: ob.id, alive: false, done: false,
        /* G.tide 는 감소하므로 at 은 "남은 시간" 기준.
           물때의 28~72% 가 지났을 때 한 번 나타난다 */
        at: B.tide * rand(0.28, 0.72),
        x: 0, y: 0, dir: 1, fade: 0
      });
    }
  }


  /* ============================================================
     잠수 시작 / 종료
     ============================================================ */
  function startDive(badangId) {
    var B = BADANG_BY_ID[badangId] || BADANG[0];
    G.badang = B;
    G.o2Max = STATS.o2Max();
    G.weightMax = STATS.weightMax();
    G.o2 = G.o2Max;
    G.bag.length = 0; G.banked.length = 0;
    G.bagW = 0; G.bagRatio = 0;
    G.tideMax = B.tide; G.tide = B.tide; G.tideEnding = 0;
    G.mulsum = false; G.mulsumFired = false; G.mulsumEver = false;
    G.newDex.length = 0;
    /* ★ 일지용 — '여'는 시작부터 열려 있어 "해금되고 처음"이 성립하지 않는다.
       승급으로 열린 바다(감태숲·깊은 여)에 한해서만, 이번이 정말 처음이면 기록한다. */
    G.firstBadangEntry = (B.rank !== 'hagun' && !PROGRESS.visitedBadang[B.key]) ? B.name : '';
    PROGRESS.visitedBadang[B.key] = true;
    G.lanternOn = B.lantern && PROGRESS.lantern;
    G.submerged = false;
    G.rescue = null; G.over = false;
    G.maxDepth = 0; G.dayEarn = 0; G.dayItems = {};
    G.harvest.target = null; G.harvest.t = 0; G.harvest.prog = 0; G.harvest.stage = 1;
    G.flying.length = 0; G.hitstopT = 0; G.bagPopT = 0;
    G.bubbleT = 0;

    var P = G.player;
    P.x = CONFIG.TEWAK_X; P.y = -4;
    P.vx = 0; P.vy = 0;
    P.ang = -Math.PI/2; P.angTarget = -Math.PI/2;
    P.curl = 0; P.kick = 0;

    /* 카메라를 처음부터 유효 범위 안에 놓는다 (첫 프레임에 월드 바깥이 보이지 않게) */
    G.cam.zoom = 1; G.cam.sx = 0; G.cam.sy = 0;
    G.cam.cx = clamp(P.x, CONFIG.VIEW_W / 2, Math.max(CONFIG.VIEW_W / 2, CONFIG.WORLD_WIDTH - CONFIG.VIEW_W / 2));
    G.cam.bias = CONFIG.CAM_BIAS_SHALLOW;
    G.cam.cy = 150 + CONFIG.VIEW_H * G.cam.bias;

    generateStage(B);
    FX.reset();
    INPUT.clear();
    PROGRESS.stat.dives++;

    G.state = 'dive';
    G.paused = false;
    AUDIO.bgm(false);
    AUDIO.suspendAmbience(false);
    if (typeof UI !== 'undefined') UI.onStateChange('dive');
  }

  /* reason: 'tide' | 'blackout' | 'quit' */
  function endDive(reason) {
    if (G.over) return;
    G.over = true;

    /* 날아가는 중이던 채집물은 도착을 기다리지 않고 그대로 망사리에 넣는다.
       (블랙아웃이면 아래에서 손에 든 것과 함께 정상적으로 손실 처리된다) */
    for (var fi = 0; fi < G.flying.length; fi++) {
      G.bag.push({ id: G.flying[fi].id, value: G.flying[fi].value, bonus: G.flying[fi].bonus });
    }
    G.flying.length = 0;
    recalcBag();

    /* ★ 손실은 실패했을 때 손에 든 것뿐.
       물때가 끝나 나오는 것은 실패가 아니므로 들고 있던 것도 챙겨 나온다. */
    if (reason !== 'blackout') {
      for (var i = 0; i < G.bag.length; i++) G.banked.push(G.bag[i]);
    }
    G.bag.length = 0;
    recalcBag();

    /* 정산 집계 */
    var tally = {}, total = 0;
    for (var j = 0; j < G.banked.length; j++) {
      var it = G.banked[j];
      if (!tally[it.id]) tally[it.id] = { id: it.id, n: 0, sum: 0, bonus: false };
      tally[it.id].n++;
      tally[it.id].sum += it.value;
      if (it.bonus) tally[it.id].bonus = true;
      total += it.value;
    }
    var rows = [];
    for (var k in tally) rows.push(tally[k]);
    rows.sort(function (a, b) { return b.sum - a.sum; });

    /* ★ 일지가 "최대 수심 갱신"을 알아야 하므로 갱신 전에 판정한다.
       0m 짜리(들어가자마자 나온) 물때는 갱신으로 치지 않는다. */
    var deepest = G.maxDepth > PROGRESS.stat.bestDepth && G.maxDepth > 0.5;
    if (G.maxDepth > PROGRESS.stat.bestDepth) PROGRESS.stat.bestDepth = G.maxDepth;

    FX.reset();
    INPUT.clear();
    AUDIO.suspendAmbience(true);
    AUDIO.stopHeart();
    G.state = 'bulteok';
    if (typeof UI !== 'undefined') {
      UI.showSettle({
        rows: rows, total: total, depth: G.maxDepth, reason: reason,
        mulsum: G.mulsumEver, newDex: G.newDex.slice(), deepest: deepest,
        firstBadang: G.firstBadangEntry
      });
    }
  }


  /* ============================================================
     업데이트 — dtRaw 는 클램프된 실시간, dt 는 타임스케일 반영
     ============================================================ */
  function update(dtRaw) {
    PROGRESS.stat.playSec += dtRaw;
    FX.update(dtRaw, baseZoom());
    if (G.state !== 'dive' || G.paused) return;

    var dt = dtRaw * FX.timeScale;
    GT += dt;   /* 히트스톱(dt=0)에 함께 멈추는 시간 축 — 채집 저항의 흔들림에 쓴다 */
    var P = G.player;

    /* ── 물때 타이머 — dtRaw ── */
    if (!G.rescue && !G.tidePaused) {
      G.tide -= dtRaw;
      if (G.tide <= 0) {
        G.tide = 0;
        if (G.tideEnding === 0) {
          G.tideEnding = 1;
          if (typeof UI !== 'undefined') UI.toast(LINES.tideEnd);
          setTimeout(function () { if (G.state === 'dive') endDive('tide'); }, 1600);
        }
      }
    }

    /* ── 실패 5단계 진행 ── */
    if (G.rescue) { updateRescue(dtRaw); return; }

    /* ── 조작 → 목표 속도 ─────────────────────────────────
       ★ 가까울수록 느리게 = 정밀 조작 */
    var ps = RENDER.w2s(G.cam, P.x, P.y);
    var inp = INPUT.sample(ps.x, ps.y);
    var wr = weightRatio();
    var vT = { x: 0, y: 0 };
    var dist = Math.hypot(inp.dx, inp.dy);
    if (dist > CONFIG.POINTER_DEADZONE) {
      var mag = clamp(dist / CONFIG.POINTER_FULL_DIST, 0, 1);
      var ux = inp.dx / dist, uy = inp.dy / dist;
      var sy = uy > 0 ? descendSpeed() : ascendSpeed();
      vT.x = ux * mag * moveSpeed();
      vT.y = uy * mag * sy;
    }
    var ascending = false;
    if (inp.ascend) { vT.y = -ascendSpeed(); ascending = true; }
    else if (vT.y < -0.05) ascending = true;

    /* ★ 무게가 시간상수를 키운다 = 무겁게 따라온다.
       FOLLOW_TAU_BASE 0.28 = 0.28초 후 목표 속도의 63%. 만재 시 0.63초. */
    var tau = CONFIG.FOLLOW_TAU_BASE + wr * CONFIG.FOLLOW_TAU_WEIGHT;
    var k = 1 - Math.exp(-dt / tau);            /* ★ dt 곱셈이 아님 */
    P.vx += (vT.x - P.vx) * k;
    P.vy += (vT.y - P.vy) * k;

    /* 2차 항력 — 물의 점성 */
    var sp = Math.hypot(P.vx, P.vy);
    if (sp > 0.01) {
      var q = Math.min(CONFIG.DRAG_QUADRATIC * sp * dt, sp);
      P.vx -= P.vx / sp * q; P.vy -= P.vy / sp * q;
    }
    /* 무게 하강 편향 — 가만히 있으면 끌려 내려간다 */
    if (P.y > 2) P.vy += wr * CONFIG.WEIGHT_SINK_BIAS * dt;

    /* 부드러운 흡착 (조건을 모두 만족할 때만) */
    applySnap(dt, inp, ascending);

    /* 적분 */
    P.x += P.vx * PPM * dt;
    P.y += P.vy * PPM * dt;

    /* 경계 */
    if (P.x < 40) { P.x = 40; P.vx = Math.max(0, P.vx); }
    if (P.x > CONFIG.WORLD_WIDTH - 40) { P.x = CONFIG.WORLD_WIDTH - 40; P.vx = Math.min(0, P.vx); }
    var fy = floorY() - 10;
    if (P.y > fy) { P.y = fy; P.vy = Math.min(0, P.vy); }
    if (P.y < -10) { P.y = -10; P.vy = Math.max(0, P.vy); }

    var dm = depthM();
    if (dm > G.maxDepth) G.maxDepth = dm;

    /* ── 몸 방향 ──
       ★ 채집 중(대상이 잡혀 있는 동안)은 이동/부력 방향과 무관하게 무조건
       채집물을 바라본다 — 저항으로 몸(P.x/P.y)이 뒤로 밀려도 방향만은
       계속 채집물을 향해야 팔이 항상 그쪽을 뻗은 것처럼 보인다
       (render.js drawDiver 의 harvesting 팔 각도가 이 P.ang 기준 로컬
       0도이므로, 여기서 P.ang 을 채집물 쪽으로 맞추면 팔도 같이 맞춰진다). */
    var speed = Math.hypot(P.vx, P.vy);
    if (G.harvest.target) {
      P.angTarget = Math.atan2(G.harvest.target.y - P.y, G.harvest.target.x - P.x);
    } else if (speed > CONFIG.ANGLE_DEADZONE_SPEED) {
      P.angTarget = Math.atan2(P.vy, P.vx);
    } else if (dm < CONFIG.SURFACE_LINE_M || speed < 0.12) {
      P.angTarget = -Math.PI/2;   /* 부력 — 머리 위로 */
    }
    var rate = CONFIG.ANGLE_TURN_RATE * (1 - wr * CONFIG.ANGLE_TURN_WEIGHT);
    P.ang = approachAngle(P.ang, P.angTarget, rate * dt);

    /* 발차기 — 산소가 없을수록 느리고 얕게 */
    var o2r = o2Ratio();
    P.kick += dt * (2.6 + speed * 2.4) * (0.45 + o2r * 0.55);
    /* ★ 산소 신호는 웅크림으로. 몸이 360도 회전하므로 기울기는 읽히지 않는다 */
    var curlTarget = clamp((0.62 - o2r) / 0.62, 0, 1);
    if (G.mulsum) curlTarget = Math.max(curlTarget, 0.85);
    P.curl += (curlTarget - P.curl) * clamp(3.0 * dt, 0, 1);

    /* ── 수면 통과 ── */
    var wasSub = G.submerged;
    G.submerged = dm > CONFIG.SURFACE_LINE_M;
    if (G.submerged && !wasSub) FX.play('dive');
    if (!G.submerged && wasSub && G.maxDepth > 1.5) FX.play('emerge');

    /* ── 산소 ─────────────────────────────────────────────
       회복은 dtRaw (연출 감속의 영향을 받지 않아야 한다) */
    if (!G.submerged) {
      G.o2 = Math.min(G.o2Max, G.o2 + (G.o2Max / CONFIG.O2_REFILL_TIME) * dtRaw);
    } else {
      var base = CONFIG.O2_DRAIN_IDLE;
      if (G.harvest.t > 0) base = CONFIG.O2_DRAIN_HARVEST;
      else if (ascending)  base = CONFIG.O2_DRAIN_ASCEND;
      else if (speed > 0.4) base = CONFIG.O2_DRAIN_MOVE;
      G.o2 -= base * (1 + dm * CONFIG.O2_DEPTH_FACTOR) * dt;
    }

    /* 물숨 라인 — 이 구간의 채집물에 보너스. 욕심이 실제로 이득이어야 유혹이 성립한다 */
    var pct = G.o2 / G.o2Max * 100;
    var wasMul = G.mulsum;
    G.mulsum = pct <= CONFIG.MULSUM_THRESHOLD && G.submerged;
    if (G.mulsum && !wasMul && !G.mulsumFired) { G.mulsumFired = true; FX.play('mulsum'); }
    if (!G.mulsum && wasMul) G.mulsumFired = false;
    if (G.mulsum) G.mulsumEver = true;

    if (G.o2 <= 0) { G.o2 = 0; enterBlackout(); return; }

    /* ── 기포 — 가장 좋은 산소 신호. 물숨에서는 멈춘다 ── */
    if (!G.mulsum && G.submerged) {
      G.bubbleT -= dt;
      if (G.bubbleT <= 0) {
        G.bubbleT = CONFIG.BUBBLE_INTERVAL_BASE * (1 + (1 - o2r) * 2.4);
        var bp = frontPoint(P, 0.34);
        FX.spawnBubble(bp.x, bp.y, false);
        if (Math.random() < 0.35) AUDIO.bubble(false);
      }
    }

    /* ── 채집 ── */
    updateHarvest(dt, speed);
    updateFlying(dt);

    /* ── 테왁 ── */
    updateTewak();

    /* ── 긴급 방출 ── */
    if (INPUT.consumeRelease()) emergencyRelease();
    if (INPUT.consumeEsc()) endDive('quit');

    /* ── 관찰 생물 ── */
    updateObservers(dt);

    /* ── 오디오 ── */
    AUDIO.setDepth(dm, CONFIG.VIS_DEPTH_REF);
    AUDIO.updateHeart(pct);

    updateCamera(dtRaw);
  }

  /* 몸 앞쪽(머리) 월드 좌표 */
  function frontPoint(P, f) {
    var h = CONFIG.VIEW_H * CONFIG.CHAR_HEIGHT_PCT;
    return { x: P.x + Math.cos(P.ang) * h * f, y: P.y + Math.sin(P.ang) * h * f };
  }


  /* ============================================================
     부드러운 흡착 — 의도를 돕는 것이지 가로채는 것이 아니다
     ============================================================ */
  function applySnap(dt, inp, ascending) {
    if (ascending) return;                       /* ★ 귀환하려는데 붙잡으면 최악 */
    var P = G.player;
    var sp = Math.hypot(P.vx, P.vy);
    if (sp < 0.15) return;
    var R = CONFIG.HARVEST_RADIUS * CONFIG.SNAP_RADIUS_MULT;
    var mv = Math.atan2(P.vy, P.vx);
    for (var i = 0; i < G.critters.length; i++) {
      var c = G.critters[i];
      if (c.taken) continue;
      var dx = c.x - P.x, dy = c.y - P.y;
      var d = Math.hypot(dx, dy);
      if (d > R || d < 1) continue;
      var s = SPECIES_BY_ID[c.id];
      if (G.bagW + s.weight > G.weightMax) continue;   /* 망사리에 여유가 없으면 */
      var ad = Math.abs(((Math.atan2(dy, dx) - mv + Math.PI * 3) % (Math.PI*2)) - Math.PI);
      if (ad > CONFIG.SNAP_ANGLE_TOL) continue;
      var f = CONFIG.SNAP_FORCE * (1 - d / R) * dt;
      P.vx += dx / d * f; P.vy += dy / d * f;
      return;
    }
  }


  /* ============================================================
     채집 — 3단계 저항 시스템

     ★ 정지해야 새 채집을 건다("이동하면 취소"는 그대로). 일단 걸리고 나면
       채집물이 플레이어를 밀어내는 힘이 붙는다. 밀려서 반경(HARVEST_RADIUS
       × 1.18)을 벗어나면 그제서야 취소된다 — 저항 자체는 취소 사유가
       아니라 버텨야 하는 대상이다.

     진행도(prog, 0~1)는 3구간으로 나뉘어 구간마다 속도가 다르다.
       1구간(~STAGE1_END)      — 빠르게 붙는다
       2구간(~STAGE2_END)      — 가장 느린 "버티기" 구간
       3구간(~1.0)             — 버티기를 넘기면 빠르게 마무리된다
     ============================================================ */
  function stageOfProg(p) {
    if (p < CONFIG.STAGE1_END) return 1;
    if (p < CONFIG.STAGE2_END) return 2;
    return 3;
  }

  /* 완료 — 잡는 순간의 임팩트. 채집물은 사라지지 않고 날아간다(updateFlying). */
  function completeHarvest(H, c, sp) {
    c.taken = true;
    var bonus = G.mulsum;
    /* ★ 물숨 구간의 채집물에 보너스 — 욕심이 실제로 이득이어야 유혹이 성립한다 */
    var val = Math.round(sp.value * (bonus ? CONFIG.MULSUM_BONUS : 1));
    if (dexRecord(sp.id, null)) G.newDex.push(sp.id);

    var P = G.player;
    var dx = P.x - c.x, dy = P.y - c.y, dd = Math.hypot(dx, dy) || 1;
    P.vx += dx / dd * CONFIG.KNOCKBACK * 0.09;
    P.vy += dy / dd * CONFIG.KNOCKBACK * 0.09;
    FX.shake(CONFIG.CAM_KICK * 0.28, 0.16);
    FX.spawnSand(c.x, c.y, Math.round(CONFIG.SAND_AMOUNT * 0.6));
    FX.spawnBubble(c.x, c.y, false);
    G.hitstopT = CONFIG.HITSTOP_MS;
    AUDIO.sfx('harvest');

    G.flying.push({ id: sp.id, value: val, bonus: bonus, x0: c.x, y0: c.y, t: 0, dur: CONFIG.FLY_DURATION });

    H.target = null; H.t = 0; H.prog = 0;
  }

  function updateHarvest(dt, speed) {
    var P = G.player, H = G.harvest;

    if (H.target) {
      var t = H.target;
      if (t.taken) { H.target = null; H.t = 0; H.prog = 0; return; }
      var sp = SPECIES_BY_ID[t.id];

      var dist = Math.hypot(t.x - P.x, t.y - P.y);
      if (dist > CONFIG.HARVEST_RADIUS * 1.18) {
        /* ★ 반경을 벗어나면 취소. 이 개체는 다음 시도부터 더 힘들어진다 */
        t.attempts = (t.attempts || 0) + 1;
        H.target = null; H.t = 0; H.prog = 0;
        return;
      }
      if (G.bagW + sp.weight > G.weightMax) { H.target = null; H.t = 0; H.prog = 0; return; }

      /* ── 밀어내는 힘. 방향은 채집물→플레이어.
         재시도한 개체는 저항도 소요시간도 더 세진다(최대 2회 누적). ── */
      var att = Math.min(t.attempts || 0, 2);
      var pullMult = Math.pow(CONFIG.RETRY_PULL_MULT, att);
      var timeMult = Math.pow(CONFIG.RETRY_TIME_MULT, att) * H.variance;
      var curPull = (sp.pull || 0.3) * CONFIG.PULL_MULT * (1 + weightRatio() * CONFIG.PULL_WEIGHT) * pullMult;

      var pdx = P.x - t.x, pdy = P.y - t.y;
      var pang = Math.atan2(pdy, pdx);
      if (sp.wobble) pang += Math.sin(GT * 6.5 + t.ph) * 0.6;   /* 문어류 — 미는 방향이 흔들린다 */
      P.vx += Math.cos(pang) * curPull * dt;
      P.vy += Math.sin(pang) * curPull * dt;

      /* 손맛 — 모래가 자꾸 인다 */
      if (Math.random() < CONFIG.SAND_AMOUNT * dt) {
        FX.spawnSand(t.x + rand(-6, 6), t.y + rand(-4, 4), 1);
      }

      /* ── 진행도. 구간마다 속도가 다르다 ── */
      var curStage = stageOfProg(H.prog);
      var stageSpeed = curStage === 1 ? CONFIG.STAGE1_SPEED : (curStage === 2 ? CONFIG.STAGE2_SPEED : CONFIG.STAGE3_SPEED);
      var effHold = Math.max(0.05, sp.hold * timeMult);
      H.prog += (dt / effHold) * stageSpeed;
      H.t += dt;

      /* ★ 미끄러짐 — 버티기 구간을 막 넘는 순간 확률적으로 한 번, 도로 밀린다 */
      if (H.slipArmed && !H.slipped && H.prog >= CONFIG.STAGE2_END) {
        H.prog = CONFIG.STAGE2_END - 0.15;
        H.slipped = true;
        AUDIO.sfx('hv_slip');
        FX.shake(CONFIG.CAM_KICK * 0.12, 0.14);
      }
      H.prog = clamp(H.prog, 0, 1);

      var newStage = stageOfProg(H.prog);
      if (newStage > H.stage) AUDIO.sfx(newStage === 2 ? 'hv_stage2' : 'hv_stage3');
      H.stage = newStage;

      if (H.prog >= 1) completeHarvest(H, t, sp);
      return;
    }

    /* ── 새 채집 시작 — 멈춰야 건다 ── */
    if (speed > CONFIG.HARVEST_MOVE_CANCEL) return;

    var best = null, bd = CONFIG.HARVEST_RADIUS;
    for (var i = 0; i < G.critters.length; i++) {
      var c = G.critters[i];
      if (c.taken) continue;
      var d = Math.hypot(c.x - P.x, c.y - P.y);
      if (d < bd) {
        var s = SPECIES_BY_ID[c.id];
        if (G.bagW + s.weight > G.weightMax) continue;
        bd = d; best = c;
      }
    }
    if (!best) return;

    H.target = best; H.t = 0; H.prog = 0; H.stage = 1;
    H.variance = 1 + rand(-CONFIG.TIME_VARIANCE, CONFIG.TIME_VARIANCE);
    H.slipArmed = Math.random() < CONFIG.SLIP_CHANCE;
    H.slipped = false;
  }

  /* ============================================================
     날아가는 채집물 — 완료된 채집물이 사라지지 않고 곡선을 그리며
     망사리로 날아간다. 무게(=진행도)는 도착 시점에 붙는다.
     ============================================================ */
  function updateFlying(dt) {
    for (var i = G.flying.length - 1; i >= 0; i--) {
      var f = G.flying[i];
      f.t += dt;
      if (f.t < f.dur) continue;

      G.bag.push({ id: f.id, value: f.value, bonus: f.bonus });
      recalcBag();
      G.bagPopT = CONFIG.BAG_POP;
      /* 도착 순간 살짝 가라앉는 힘 — 무거운 놈일수록 크게 */
      G.player.vy += (SPECIES_BY_ID[f.id].weight / G.weightMax) * 0.6;
      AUDIO.sfx('bagpop');
      if (G.bagW / G.weightMax > 0.98 && typeof UI !== 'undefined') UI.toast(LINES.bagFull);
      G.flying.splice(i, 1);
    }
    if (G.bagPopT > 0) { G.bagPopT -= dt; if (G.bagPopT < 0) G.bagPopT = 0; }
  }


  /* ============================================================
     테왁 — 수면의 세이브 포인트
     매 왕복마다 "지금 비우고 또 들어갈까"가 강제 발생한다
     ============================================================ */
  function updateTewak() {
    var P = G.player;
    if (depthM() > 1.4) return;
    if (Math.hypot(P.x - CONFIG.TEWAK_X, P.y) > CONFIG.TEWAK_RADIUS + 26) return;
    if (G.bag.length === 0) return;
    for (var i = 0; i < G.bag.length; i++) G.banked.push(G.bag[i]);
    G.bag.length = 0;
    recalcBag();
    AUDIO.sfx('bank');
    FX.spawnBubble(P.x, P.y, true);
    if (typeof UI !== 'undefined') UI.toast(LINES.banked);
  }

  /* 긴급 방출 — 살기 위해 방금 딴 것을 놓아주는 선택지 */
  function emergencyRelease() {
    if (G.bag.length === 0) return;
    var P = G.player;
    FX.spawnScatter(P.x, P.y, G.bag);
    G.bag.length = 0;
    recalcBag();
    AUDIO.sfx('release');
    if (typeof UI !== 'undefined') UI.toast(LINES.released);
  }


  /* ============================================================
     관찰 3종 — 채집 불가. 접근하면 기록.
     지나갈 때 채집 게이지를 취소하지 않는다.
     ============================================================ */
  function updateObservers(dt) {
    var P = G.player;
    for (var i = 0; i < G.observers.length; i++) {
      var o = G.observers[i];
      var sp = SPECIES_BY_ID[o.id];

      if (!o.alive && !o.done && G.tide <= o.at) {
        o.alive = true;
        o.dir = Math.random() < 0.5 ? 1 : -1;
        o.x = o.dir > 0 ? -sp.w : CONFIG.WORLD_WIDTH + sp.w;
        /* 플레이어가 있는 깊이 쪽으로 살짝 붙여 준다 (조건이 승급이므로) */
        var band = clamp(depthM(), sp.minD, sp.maxD);
        o.y = clamp(band + rand(-1.6, 1.6), sp.minD, sp.maxD) * PPM;
        o.fade = 0;
        continue;
      }
      if (!o.alive) continue;

      o.x += o.dir * sp.speed * PPM * dt;
      o.y += Math.sin(o.x * 0.006) * 8 * dt;
      o.fade = Math.min(1, o.fade + dt * 1.6);

      if (o.x < -sp.w * 2.2 || o.x > CONFIG.WORLD_WIDTH + sp.w * 2.2) {
        o.alive = false; o.done = true;
        continue;
      }

      /* 조우 */
      if (Math.hypot(o.x - P.x, o.y - P.y) < CONFIG.ENCOUNTER_RADIUS) {
        var isNew = !dexHas(o.id);
        if (isNew) {
          /* ★ 첫 조우 프레임이 캡처되어 도감 카드가 된다.
             해녀 실루엣이 같이 들어가 크기 비교가 되고, 추가 아트가 0장이다. */
          var shot = RENDER.capture(G.cam, (o.x + P.x) / 2, (o.y + P.y) / 2);
          if (dexRecord(o.id, shot)) G.newDex.push(o.id);
          FX.play('encounter', { focus: { x: o.x, y: o.y } });
          if (typeof UI !== 'undefined') UI.toast(sp.name + ' — 도감에 기록');
        }
      }
    }
  }


  /* ============================================================
     실패 5단계 — 죽지 않습니다
       1 기포 정지 → 2 시간 감속 + 소리 멀어짐 → 3 동료가 끌고 상승
       → 4 망사리 끈이 풀리며 채집물이 흩어짐 → 5 불턱에서 깨어남
     ============================================================ */
  function enterBlackout() {
    if (G.rescue) return;
    G.rescue = { t: 0, scattered: false };
    FX.clearBubbles();                 /* 1 */
    FX.play('fail');                   /* 2 */
    AUDIO.updateHeart(0);
    if (typeof UI !== 'undefined') UI.toast(LINES.blackout);
  }

  function updateRescue(dtRaw) {
    var R = G.rescue, P = G.player;
    R.t += dtRaw;

    /* 3 — 동료가 아래에서 올라와 끌고 상승 */
    if (R.t > 0.6) {
      P.y -= CONFIG.BLACKOUT_RISE_SPEED * PPM * dtRaw * 0.55;
      P.vx *= 0.9; P.vy = 0;
      P.angTarget = -Math.PI/2;
      P.ang = approachAngle(P.ang, P.angTarget, 2.4 * dtRaw);
      P.curl = Math.min(1, P.curl + dtRaw);
    }
    /* 4 — 망사리 끈이 풀린다. 잃는 것은 손에 든 것뿐 */
    if (!R.scattered && R.t > 1.3) {
      R.scattered = true;
      FX.spawnScatter(P.x, P.y, G.bag);
      G.bag.length = 0;
      recalcBag();
    }
    if (P.y < 0) P.y = 0;
    updateCamera(dtRaw);
    /* 5 */
    if (R.t > 4.2) endDive('blackout');
  }


  /* ============================================================
     카메라
     ★ 줌은 연출 전용으로 비워둔다. 평소에 가만히 있어야
       결정적 순간에 말을 한다. 수심 압박은 3층 가시성이 담당.
     ============================================================ */
  function baseZoom() {
    if (G.state !== 'dive') return 1;
    return lerp(CONFIG.CAM_ZOOM_NORMAL, CONFIG.CAM_ZOOM_DEEP, RENDER.depthRatio(G.player.y));
  }

  function updateCamera(dtRaw) {
    var cam = G.cam, P = G.player;
    cam.zoom = FX.zoomOf(baseZoom());

    /* ── 수면 경계 / 깊이 연동 카메라 바이어스 ──
       얕을수록 하늘이 많이 보이도록(CAM_BIAS_SHALLOW), 깊을수록 아래쪽 위주로
       (CAM_BIAS_DEEP) 프레이밍이 전환된다. smoothstep 으로 REF_M 안에서만 보간.
       ★ 상승해서 REF_M 아래로 들어온 구간만 CAM_BIAS_TAU_FAST 로 빠르게 따라잡는다.
         테왁의 짧은 수면 대기(O2_REFILL_TIME) 안에 하늘이 열리는 느낌을 내려면
         기본 TAU(2초)만으로는 63%밖에 전환되지 않기 때문 (config.js 주석 참조). */
    var dm = depthM();
    var biasT = smoothstep(clamp(dm / CONFIG.CAM_BIAS_REF_M, 0, 1));
    var targetBias = lerp(CONFIG.CAM_BIAS_SHALLOW, CONFIG.CAM_BIAS_DEEP, biasT);
    var biasTau = (P.vy < 0 && dm < CONFIG.CAM_BIAS_REF_M) ? CONFIG.CAM_BIAS_TAU_FAST : CONFIG.CAM_BIAS_TAU;
    cam.bias += (targetBias - cam.bias) * (1 - Math.exp(-dtRaw / biasTau));

    var tx = P.x, ty = P.y + clamp(P.vy, -1.4, 1.4) * PPM * CONFIG.CAM_LOOK_OFFSET * 2.2;

    /* 연출 포커스 (첫 조우) */
    var f = FX.focusOf();
    if (f) { tx = lerp(tx, f.p.x, f.k * 0.85); ty = lerp(ty, f.p.y, f.k * 0.85); }

    var halfW = (CONFIG.VIEW_W / 2) / cam.zoom;
    var halfH = (CONFIG.VIEW_H / 2) / cam.zoom;

    /* y — 수면이 화면 위쪽 150px 근처에 오도록 하한을 둔다(바이어스만큼 밀려난다).
       가로 화면에서 하늘이 과하게 보이면 수심 감각이 죽는다.
       상한은 바닥이 화면 아래쪽에 걸리는 지점. 여(12m)처럼 얕은 바당은
       스테이지 전체가 화면보다 얕으므로 두 값이 거의 붙는다. */
    var biasPx = CONFIG.VIEW_H * cam.bias;
    ty += biasPx;
    var minCy = (150 + biasPx) / cam.zoom;
    var maxCy = Math.max(minCy, floorY() - halfH + 150 + biasPx);

    /* ★ 최종 안전장치 — 위 프레이밍 계산이 무엇을 내놓든, 해녀는 항상 화면 안에
       있어야 한다. 깊은 바당에서 급강하하는 동안 바이어스가 아직 다 수렴하지
       못한 채로 floorY() 기준 maxCy 가 확정되면, 그 값이 실제 플레이어 위치와
       동떨어져 해녀가 화면 위/아래로 사라지는 사고가 났다. 플레이어 y 기준
       안전 범위로 한 번 더 조인다. */
    var margin = CONFIG.CAM_DIVER_MARGIN / cam.zoom;
    minCy = Math.max(minCy, P.y - (halfH - margin));
    maxCy = Math.min(maxCy, P.y + (halfH - margin));
    if (minCy > maxCy) { var midCy = (minCy + maxCy) / 2; minCy = maxCy = midCy; }

    ty = clamp(ty, minCy, maxCy);

    /* x — 월드가 화면보다 넓을 때만 스크롤 */
    if (CONFIG.WORLD_WIDTH > halfW * 2) tx = clamp(tx, halfW, CONFIG.WORLD_WIDTH - halfW);
    else tx = CONFIG.WORLD_WIDTH / 2;

    var lp = clamp(CONFIG.CAM_FOLLOW_LERP * (dtRaw * 60), 0, 1);
    cam.cx += (tx - cam.cx) * lp;
    cam.cy += (ty - cam.cy) * lp;

    /* 보간 결과에도 같은 한계를 다시 건다.
       목표만 클램프하면 따라가는 동안 월드 바깥이 보인다. */
    if (CONFIG.WORLD_WIDTH > halfW * 2) cam.cx = clamp(cam.cx, halfW, CONFIG.WORLD_WIDTH - halfW);
    cam.cy = clamp(cam.cy, minCy, maxCy);

    var sh = FX.shakeOf();
    cam.sx = sh.x; cam.sy = sh.y;
  }


  /* ============================================================
     메인 루프 — 고정 타임스텝 + delta clamp
     ============================================================ */
  var FIXED = 1 / 60;
  var acc = 0, last = 0, running = false;
  var frameMs = 0, renderMs = 0, fps = 60, fpsAcc = 0, fpsN = 0;

  function loop(ts) {
    if (!running) return;
    requestAnimationFrame(loop);
    if (!last) { last = ts; return; }
    var raw = (ts - last) / 1000;
    last = ts;
    if (raw > 0.10) raw = 0.10;          /* delta clamp — 탭 전환 후 튀는 것 방지 */

    var t0 = performance.now();

    acc += raw;
    var steps = 0;
    while (acc >= FIXED && steps < 5) {
      var stepDt = FIXED;
      /* ★ 히트스톱 — 물리만 정지. dt=0 으로 update() 를 그대로 호출하므로
         이 프레임의 렌더는 정상적으로 이어진다(잠깐 얼어붙는 느낌만 남는다). */
      if (G.hitstopT > 0) { G.hitstopT -= FIXED * 1000; stepDt = 0; }
      update(stepDt);
      acc -= FIXED; steps++;
    }
    if (steps === 5) acc = 0;

    var t1 = performance.now();
    render(raw);
    var t2 = performance.now();

    frameMs = t1 - t0; renderMs = t2 - t1;
    fpsAcc += raw; fpsN++;
    if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }

    if (typeof UI !== 'undefined') UI.tick(raw);
  }

  function render(raw) {
    if (G.state === 'dive') RENDER.drawDive(G, raw);
    else if (G.state === 'title') RENDER.drawTitle(raw);
    else if (G.state === 'bulteok') RENDER.drawBulteok(raw);
    else if (G.state === 'journal') RENDER.clearCanvas();
  }

  function start() {
    if (running) return;
    running = true; last = 0;
    requestAnimationFrame(loop);
  }

  function goto(s) {
    G.state = s;
    if (s === 'bulteok') { AUDIO.suspendAmbience(true); AUDIO.stopHeart(); AUDIO.bgm(true); }
    else if (s === 'title') { AUDIO.bgm(false); AUDIO.suspendAmbience(true); AUDIO.stopHeart(); }
    if (typeof UI !== 'undefined') UI.onStateChange(s);
  }

  return {
    G: G, start: start, goto: goto,
    startDive: startDive, endDive: endDive,
    depthM: depthM, o2Ratio: o2Ratio, weightRatio: weightRatio,
    ascendSpeed: ascendSpeed, moveSpeed: moveSpeed, descendSpeed: descendSpeed,
    recalcBag: recalcBag, generateStage: generateStage,
    emergencyRelease: emergencyRelease,
    pause: function (v) { G.paused = !!v; },
    stats: function () { return { fps: fps, updateMs: frameMs, renderMs: renderMs }; }
  };
})();
