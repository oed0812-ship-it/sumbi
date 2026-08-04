/* ============================================================
   숨비 (SUMBI) — data.js
   생물 12종 / 바당 3곳 / 장비 / 살림 / 승급 / 도감 텍스트 / 대사

   ⚠ 생물 명칭·서식 정보와 제주어 대사는 밸런스용 가안입니다.
      제주해녀박물관 등 공식 자료로 교차 확인 후 확정하고
      credits.md 에 출처를 표기하세요.
   ⚠ 문구는 나중에 한 번에 다듬을 예정이므로 다른 파일에 하드코딩 금지.
   ============================================================ */
var SUMBI = SUMBI || {};

/* ── 채집 9종 ────────────────────────────────────────────────
   ★ 실제 서식 수심 자료 조사 결과에 맞춰 재배치(얕은→깊은 순):
     보말 → 미역 → 돌게 → 뿔소라 → 성게 → 오분자기 → 해삼 → 전복 → 문어.
     value 도 이 순서대로 단조 증가하게 다시 매겼습니다(깊을수록 비쌈).
     minD/maxD·spawnW(바당별 등장) 조합 9개는 원래 자료 그대로 재사용하고,
     이번에 정해진 순서대로 종에 배분한 것이라 "서식 깊이 → 등장 바당" 매핑
     구조 자체는 바뀌지 않았습니다.
   spawnW = 바당 내 스폰 가중치 (합이 1일 필요 없음)
   ---------------------------------------------------------- */
/* pull = 채집 저항 시스템의 기본 저항값 (js/config.js PULL_MULT 와 곱해진다).
   무게·서식 습성과 대략 비례하게 잡았습니다 — 바위에 붙어 버티는 종일수록 세게.
   ★ weight/hold/pull/r/col 은 종 고유 특성이라 이번 수심 재배치에도 그대로 둡니다. */
var SPECIES = [
  { id:'bomal',      name:'보말',      kind:'harvest', minD:2,  maxD:6,  weight:0.6, value:200,  hold:0.4, r:9,
    col:[122,96,68],   spawnW:{1:0.27}, pull:0.18,
    info:['수심 2~6m 갯바위', '제철 — 사계절'],
    voice:'국 끓이면 이만한 게 없주. 애기들도 잘 먹어.' },

  { id:'miyeok',     name:'미역',      kind:'harvest', minD:2,  maxD:7,  weight:0.8, value:300,  hold:0.8, r:11,
    col:[42,84,62],    spawnW:{1:0.25}, pull:0.12,
    info:['수심 2~7m 조간대 바위', '제철 — 겨울에서 봄'],
    voice:'봄미역이 제일이여. 낫으로 밑동을 잘라야 다시 나.' },

  /* ★ 감태숲(badang2) spawnW — 돌게가 유독 자주 보인다는 피드백으로
     0.22 → 0.13(원래의 약 60%)로 낮추고, 뺀 만큼을 같은 바당의 비슷한
     수심대(뿔소라·성게·오분자기·해삼)에 원래 비중대로 나눠 채웠습니다.
     여(badang1)·깊은 여(badang3) 쪽 비중은 이번에 건드리지 않았습니다. */
  { id:'dolge',      name:'돌게',      kind:'harvest', minD:3,  maxD:9,  weight:2.2, value:500,  hold:2.5, r:17,
    col:[186,64,58],   spawnW:{1:0.27, 2:0.13}, pull:0.42,
    info:['수심 3~9m 얕은 돌 틈', '제철 — 가을에서 겨울'],
    voice:'돌 틈에 딱 붙어 있주. 손 넣을 때 집게 조심해사.' },

  { id:'sora',       name:'뿔소라',    kind:'harvest', minD:5,  maxD:12, weight:1.0, value:1200, hold:0.6, r:12,
    col:[196,124,58],  spawnW:{1:0.21, 2:0.27}, pull:0.32,
    info:['수심 5~12m 암반', '제철 — 봄에서 초여름'],
    voice:'뿔 있는 놈이 살이 실해. 작은 건 두고 와야지.' },

  { id:'seonggae',   name:'성게',      kind:'harvest', minD:8,  maxD:15, weight:1.2, value:1500, hold:1.0, r:13,
    col:[118,62,124],  spawnW:{2:0.24}, pull:0.50,
    info:['수심 8~15m 바위 틈', '제철 — 여름'],
    voice:'가시 조심허라. 알이 노랗게 찬 때가 있어.' },

  { id:'obunjagi',   name:'오분자기',  kind:'harvest', minD:10, maxD:17, weight:1.8, value:2500, hold:1.8, r:15,
    col:[64,132,124],  spawnW:{2:0.22, 3:0.30}, pull:0.60,
    info:['수심 10~17m 암반', '제철 — 여름'],
    voice:'전복이랑 헷갈리주. 작아도 값은 잘 쳐줘.' },

  { id:'haesam',     name:'해삼',      kind:'harvest', minD:12, maxD:20, weight:1.5, value:4000, hold:1.2, r:14,
    col:[86,64,52],    spawnW:{2:0.13, 3:0.22}, pull:0.28,
    info:['수심 12~20m 모래 섞인 바닥', '제철 — 겨울'],
    voice:'느릿느릿해도 손에 쥐면 묵직허다.' },

  { id:'jeonbok',    name:'전복',      kind:'harvest', minD:16, maxD:24, weight:2.5, value:6000, hold:2.8, r:16,
    col:[92,160,168],  spawnW:{3:0.28}, pull:0.78,
    info:['수심 16~24m 바위에 밀착', '제철 — 가을'],
    voice:'빗창 한 번에 떼야 해. 놓치면 더 붙어버려.' },

  /* ★ 문어만 wobble:true — 미는 방향이 흔들린다(문어류 특성). game.js updateHarvest 참조 */
  { id:'munuh',      name:'문어',      kind:'harvest', minD:19, maxD:26, weight:3.5, value:9000, hold:2.5, r:19,
    col:[168,74,86],   spawnW:{3:0.20}, pull:0.90, wobble:true,
    info:['수심 19~26m 깊은 여의 굴', '제철 — 가을에서 겨울'],
    voice:'값은 크주. 근디 무거워. 욕심내면 못 올라와.' },

  /* ── 관찰 전용 3종 ──────────────────────────────────────
     채집 불가. 접근하면 도감에 기록.
     ★ 승급 조건이므로 물때당 1회 확정 출현 (game.js).
     ---------------------------------------------------- */
  { id:'dolphin',    name:'남방큰돌고래', kind:'observe', badang:1, minD:2,  maxD:5,  w:190, h:62,
    col:[124,148,166], speed:1.35,
    info:['제주 연안 정착 무리', '수면 가까이에서 무리지어 이동'],
    voice:'저놈들 지나가면 그날은 물이 좋아.' },

  { id:'turtle',     name:'푸른바다거북', kind:'observe', badang:2, minD:8,  maxD:14, w:118, h:78,
    col:[96,132,102],  speed:0.55,
    info:['제주 연안 회유', '해조류를 뜯으며 천천히 유영'],
    voice:'급할 것 없이 가는구나. 나도 저래야 하는디.' },

  { id:'ray',        name:'쥐가오리',    kind:'observe', badang:3, minD:19, maxD:25, w:200, h:70,
    col:[70,86,110],   speed:0.85,
    info:['수심 20m 이하 외해', '날개를 젓듯 유영'],
    voice:'그림자가 크게 지나가면 놀라주. 해코지는 안 해.' }
];

/* id → 객체 조회 */
var SPECIES_BY_ID = (function () {
  var m = {}, i;
  for (i = 0; i < SPECIES.length; i++) m[SPECIES[i].id] = SPECIES[i];
  return m;
})();

var DEX_TOTAL = SPECIES.length;   /* 12 */


/* ── 바당 3곳 ────────────────────────────────────────────────
   ★ 깊이 축만 쓰면 뒤가 앞을 완전히 대체합니다.
     확실성 축(적지만 확실 ↔ 크지만 불확실)을 유지할 것.
   ---------------------------------------------------------- */
var BADANG = [
  /* spawnMin/Max ★ 요청서 기준값은 26~32 였으나, 실측 수확이 7,120 으로
     목표(8,000~10,000)에 못 미쳐 30~36 으로 올렸습니다.
     "생물 가치는 건드리지 않는다" 원칙에 따라 개수만 조정했습니다. */
  { id:1, key:'yeo', name:'여', depthM:12, tide:150, rank:'hagun',
    tag:'짧고 안전', desc:'12m · 얕은 암초',
    lockText:'', spawnMin:30, spawnMax:36,
    kelp:0, colorLossFromM:99, lantern:false,
    shaftCount:2, shaftAlpha:0.14,
    tint:[74,195,229], rockCol:[26,52,62],
    diveLine:'바다를 아는 것이 물질의 시작이여',
    /* ★ 테왁 바로 앞에 채집물이 몰려 첫 바당이 지나치게 쉬워 보인다는
       피드백으로 추가. CONFIG.CRITTER_DIST_NEAR_FRAC(전역 0.14)보다 훨씬
       바깥에서 시작하게 해, 가장 싼 생물도 테왁 코앞이 아니라 바다 전체에
       걸쳐 놓이도록 한다(generateStage 의 distNearFrac/distFarFrac 참고).
       다른 바당은 이 필드가 없으면 그대로 전역 기본값을 쓴다.
       ★ depthBiasPow — '여'는 바당 자체가 얕아(12m) 종별 수심 구간을
       그대로 균등분포로 뽑으면 테왁(수면)과 채집물이 거의 같은 깊이에
       있는 것처럼 보인다는 피드백으로 추가. 1보다 작을수록 각 종의
       minD~maxD 구간 중 더 깊은 쪽으로 쏠린다(generateStage 참고). */
    distNearFrac:0.34, distFarFrac:0.92, depthBiasPow:0.4 },

  { id:2, key:'gamtae', name:'감태숲', depthM:20, tide:150, rank:'junggun',
    tag:'중간 · 시야가 나쁨', desc:'20m · 감태가 시야를 가림',
    lockText:'중군 승급 필요', spawnMin:30, spawnMax:36,
    kelp:34, colorLossFromM:99, lantern:false,
    shaftCount:2, shaftAlpha:0.13,
    tint:[0,182,240], rockCol:[25,55,88],
    diveLine:'감태 사이에 숨어있는 것들을 찾아보자' },

  { id:3, key:'gipeun', name:'깊은 여', depthM:26, tide:165, rank:'sanggun',
    tag:'크지만 불확실', desc:'26m · 색이 사라진다',
    lockText:'상군 승급 필요', spawnMin:28, spawnMax:34,
    kelp:8, colorLossFromM:14, lantern:true,
    shaftCount:1, shaftAlpha:0.10,
    tint:[48,102,132], rockCol:[16,34,48],
    diveLine:'이곳은 아주 깊어. 욕심부리다가는 큰일이 나.' }
];

var BADANG_BY_ID = (function () {
  var m = {}, i;
  for (i = 0; i < BADANG.length; i++) m[BADANG[i].id] = BADANG[i];
  return m;
})();


/* ── 장비 3종 × 2단계 ────────────────────────────────────────
   ★ 테왁 Lv2 가 8,000 인 것은 "앞 8분 안에 첫 승급" 페이싱 제약입니다.
     임의로 올리지 마세요.
   ★ 망사리는 용량이 늘면서 페널티도 커지는 트레이드오프가 핵심입니다.
   ---------------------------------------------------------- */
var GEAR = [
  { id:'tewak', name:'테왁',
    price:  [0, 8000, 32000],
    effect: ['상승 2.2 m/s', '상승 2.7 m/s', '상승 3.2 m/s'],
    note:'물 위에서 나를 기다리는 것' },

  { id:'mangsari', name:'망사리',
    price:  [0, 10000, 28000],
    effect: ['10kg · 저항 0.72', '14kg · 저항 0.76', '18kg · 저항 0.80'],
    note:'많이 담을수록 무겁게 끌린다' },

  { id:'muloht', name:'물옷',
    price:  [0, 14000, 38000],
    effect: ['숨 100', '숨 125', '숨 150'],
    note:'물소중이에서 고무옷으로' }
];

var GEAR_BY_ID = (function () {
  var m = {}, i;
  for (i = 0; i < GEAR.length; i++) m[GEAR[i].id] = GEAR[i];
  return m;
})();

/* 장비 레벨 → 실제 수치 (progress.js 가 참조) */
var GEAR_STATS = {
  tewak:    { ascendBase: [2.2, 2.7, 3.2] },
  mangsari: { weightMax: [10, 14, 18], penalty: [0.72, 0.76, 0.80] },
  muloht:   { o2Max: [100, 125, 150] }
};


/* ── 살림 3개 — 불턱 배경의 빈자리 ───────────────────────────
   ★ 상점 목록이 아닙니다. 배경 레이어 3장 + 클릭 핫스팟 3개가 전부입니다.
     별도 진행도 UI 금지 — 방 자체가 진행도입니다.
   hx/hy/hw/hh 는 960×600 논리 좌표 기준 핫스팟 사각형.
   revealLine = 이 자리를 known 으로 열 때(클릭 또는 안전망) 뜨는 대사.
   boughtLine = 실제로 구매했을 때 뜨는 대사. 전부 LINES 참조, 하드코딩 없음.
   ---------------------------------------------------------- */
/* ★ 살림은 불턱 "안"이 아니라 돌담 너머 언덕 위 우리 집입니다.
   불턱은 옷 갈아입고 몸 녹이는 공동 공간이라 개인 세간이 놓일 자리가 아닙니다.
   그래서 솥·책은 집의 변화(굴뚝 연기 / 창 불빛)로만 드러나고,
   핫스팟도 집 1개 + 밭 1개 = 2개뿐입니다.
   pot·books 는 같은 집 핫스팟(spot:'house')을 순차로 공유합니다. */
var HOME = [
  { id:'pot',    name:'무쇠솥',     price:15000, place:'집', spot:'house',
    hx:86, hy:264, hw:106, hh:74,
    desc:'국이라도 끓일 솥 하나.',
    revealLine:'homeReveal1', boughtLine:'potBought' },

  { id:'books',  name:'아이 책값',  price:35000, place:'집', spot:'house',
    hx:86, hy:264, hw:106, hh:74,
    desc:'아이가 밤에 볼 책.',
    revealLine:'homeReveal2', boughtLine:'booksBought' },

  { id:'field',  name:'밭 한 뙈기', price:60000, place:'집 옆 묵정밭', spot:'field',
    hx:214, hy:290, hw:104, hh:48,
    desc:'바다에 안 나가도 되는 날.',
    revealLine:'homeReveal3', boughtLine:'fieldBought' }
];

/* 핫스팟 2개 — DOM 요소 id 는 hs-house / hs-field */
var HOME_SPOTS = ['house', 'field'];

var HOME_BY_ID = (function () {
  var m = {}, i;
  for (i = 0; i < HOME.length; i++) m[HOME[i].id] = HOME[i];
  return m;
})();

/* 살림 순차 공개 순서 */
var HOME_ORDER = ['pot', 'books', 'field'];


/* ── 승급 ────────────────────────────────────────────────────
   ★ 자판기가 아니라 마을의 인정. 구매 버튼이 없습니다.
     조건 충족 시 불턱 진입 시점에 자동 승급합니다.
   ★ 도감이 조건에 들어간 것이 핵심 — "바다를 안다"가 기량의 증명.
   ---------------------------------------------------------- */
var RANKS = [
  { id:'hagun',   name:'하군', dot:1 },
  { id:'junggun', name:'중군', dot:2,
    need: { gear:{ tewak:2 }, dex:5 },
    needText:'테왁 Lv2 · 도감 5종',
    unlock:1, line:'rankJunggun' },
  { id:'sanggun', name:'상군', dot:3,
    need: { gear:{ muloht:2, tewak:3 }, dex:9 },
    needText:'물옷 Lv2 · 테왁 Lv3 · 도감 9종',
    unlock:2, line:'rankSanggun', grantLantern:true }
];

var RANK_INDEX = { hagun:0, junggun:1, sanggun:2 };


/* ── 대사 ────────────────────────────────────────────────────
   ★ 전부 가안입니다. 추후 일괄 교정 예정.
   ★ 대사 시스템을 만들지 마세요. 상황당 고정 1줄, 분기 없음.
   ---------------------------------------------------------- */
var LINES = {
  homeReveal1: '장비만 늘려서 뭐 하나. 집에도 하나 들여야지.',
  potBought:   '이제 국이라도 끓이겠다.',
  homeReveal2: '아이가 책을 보고 싶다더라.',
  booksBought: '밤에 불 켜 놓고 뭘 읽더라.',
  homeReveal3: '저 묵정밭, 임자가 없다더라.',
  fieldBought: '이제 바다에 안 나가도 되는 날이 있겠네.',

  rankJunggun: '이제 감태숲까지는 들어가도 되겠다.',
  rankSanggun: '상군이여. 깊은 여도 자네 바당이여.',
  lanternGift: '깊은 데는 이거 없이 못 간다. 가져가라.',

  blackout:    '바다는 안 도망가. 욕심부리지 말어.',
  tideEnd:     '물 들어온다. 그만 나가자.',
  ending:      '오늘은 밭에 먼저 가봐야지.',

  firstDive:   '숨은 유한하고, 바다는 도망가지 않는다.',
  bagFull:     '망사리가 다 찼다.',
  released:    '놓아주었다.',
  banked:      '테왁에 넣었다.',
  cantAfford:  '아직 돈이 모자라.',
  locked:      '아직 들어갈 수 없는 바당이여.'
};


/* ── 해녀 일지 ────────────────────────────────────────────────
   ★ 정산 화면 안에 같이 뜹니다. 별도 카드/추가 클릭을 만들지 마세요.
   ★ 매일 나오면 피로해집니다 — 문장이 아예 없는 날이 35% 있어야 합니다.
     비율은 progress.js buildJournalEntry() 가 관리합니다.

   type
     fact   사실 1줄 — 그날 바다에서 있었던 일
     feel   감상 1줄 — 사실 뒤에 붙는 속마음
     story  서사 1줄 — 앞에 표식이 붙어 "오늘은 다르다"가 읽힌다
     reward 살림을 산 다음 물때에 한 번 붙는 보상 문장
   ---------------------------------------------------------- */

/* 일차 고정 서사 — 이 날의 일지에 반드시 나오고, 살림 자리를 hinted 로 연다.
   ★ 장비 구매가 아니라 "일차"가 조건입니다. 사연이 먼저 오고 물건이 뒤에 옵니다. */
var JOURNAL_STORY_DAYS = [
  { day: 3,  hint: 'pot',    s: '솥에 칠이 벗겨져 마음에 걸린다. 새 솥이 있으면 좋겠는데.' },
  { day: 6,  hint: 'books',  s: '아이가 남의 책을 빌려 봤다더라.' },
  { day: 10, hint: 'field',  s: '문 밖 묵정밭, 임자가 없다더라.' }
];

/* 살림을 산 "다음" 물때의 일지 끝에 한 번만 붙는다 */
var JOURNAL_REWARD = {
  pot:   '오늘은 솥으로 몸국을 끓였다. 얼었던 몸이 녹았다.',
  books: '멀리서도 창에 불이 켜진 게 보인다.',
  field: '오늘은 밭에 먼저 가봤다.'
};

/* 상황이 확정된 날에 쓰는 사실 문장 (확률과 무관하게 반드시 나온다) */
var JOURNAL_FORCED = {
  blackout: '숨이 모자랐다. 동료가 끌어올려 줬다.',
  mulsum:   '물숨 자리까지 내려갔다. 나도 모르게 손이 움직였다.',
  deepest:  '오늘 가장 깊이 내려갔다.'
};

/* 평범한 날의 사실 — id 는 반복 방지에 쓴다 */
var JOURNAL_FACTS = [
  { id:'f1', s:'물이 맑아 바닥까지 보였다.' },
  { id:'f2', s:'조류가 세서 한참을 붙들고 있었다.' },
  { id:'f3', s:'테왁을 두 번 놓칠 뻔했다.' },
  { id:'f4', s:'같이 들어간 동료가 보이지 않아 무서웠다.' },
  { id:'f5', s:'바위 밑을 몇 번이나 더듬었다.' },
  { id:'f6', s:'물이 차가워 손끝이 굳었다.' },
  { id:'f7', s:'파도가 얕아 숨 고르기가 수월했다.' },
  { id:'f8', s:'망사리가 무거워 오르는 데 오래 걸렸다.' },
  { id:'f9', s:'빈손으로 올라온 적이 몇 번 있었다.' },
  { id:'f10', s:'해가 들어 물속이 환했다.' }
];

/* 감상 — 사실 뒤에 붙는다 */
var JOURNAL_FEELS = [
  { id:'g1', s:'숨은 늘 모자라고, 바다는 늘 그대로다.' },
  { id:'g2', s:'욕심을 한 번 접었다. 그래서 올라왔다.' },
  { id:'g3', s:'오늘도 무사히 나왔으면 된 거다.' },
  { id:'g4', s:'딸도 이 일을 하게 될까. 편한 일 했으면 싶다.' },
  { id:'g5', s:'물 밖은 늘 춥다. 가끔은 물속이 차라리 낫다.' },
  { id:'g6', s:'많이 못 벌었어도 손은 성하다.' },
  { id:'g7', s:'바다는 안 도망간다. 내일도 바다는 여기에 있다.' },
  { id:'g8', s:'숨 참는 법은 배웠는데, 욕심 참는 법은 아직이다.' },
  { id:'g9', s:'돌아갈 데가 있어서 내려갈 수 있다.' },
  { id:'g10', s:'물때가 짧아 아쉬웠다. 늘 아쉽다.' }
];

/* 서사 — 약 15% 의 날에 표식과 함께 한 줄만 나온다 (살림과 무관한 일상의 결) */
var JOURNAL_STORY = [
  { id:'s1', s:'스무 살에 처음 물에 들었다. 그때도 이 바다였다.' },
  { id:'s2', s:'어머니도 여기서 물질했다. 바다를 보고 있으면 어머니 생각이 난다.' },
  { id:'s3', s:'누군가 부르는 것 같았는데 아무도 없었다.' },
  { id:'s4', s:'숨비소리를 처음 들은 날, 사람 소리가 아닌 줄 알았다.' },
  { id:'s5', s:'불턱에 앉으면 따뜻하고 편하다.' },
  { id:'s6', s:'바다에 혼자 남겨진 것 같은 때, 동료가 보여 안심했다.' }
];
