/* ============================================================
   숨비 (SUMBI) — progress.js
   진행 상태 하나로 묶는다: 돈 · 장비 · 살림 · 승급 · 도감 · 일차

   ★ 저장 없이도 완전히 플레이 가능해야 합니다.
     localStorage 가 막혀 있어도 조용히 넘어가고 경고하지 않습니다.
   ============================================================ */
var SUMBI = SUMBI || {};

var PROGRESS = {
  day: 1,
  money: 0,
  rank: 'hagun',                                   /* hagun → junggun → sanggun */
  gear: { tewak: 1, mangsari: 1, muloht: 1 },      /* 1~3 */
  home: { pot: false, books: false, field: false },
  /* ★ 살림 발견 — 팝업이 아니라 환경 기반 4단계.
     hidden(빈 고리, 표시 없음) → hinted(광택 있음, 클릭 가능)
     → known(구매 카드 표시). 구매되면 home[id] 가 true 로 별도 기록된다. */
  homeState: { pot: 'hidden', books: 'hidden', field: 'hidden' },
  /* hinted 상태로 넘긴 물때 수. 2회째에 안전망 대사가 1회 뜨고 -1 로 잠긴다 */
  tideSinceHint: { pot: 0, books: 0, field: 0 },
  dex: {},                                         /* { speciesId: true } */
  firstGearBought: false,
  lantern: false,
  endingSeen: false,
  seenHowto: false,
  /* ★ 해녀 일지 — 물때 1회(=1일)마다 한 항목. 문장이 없는 날도 항목은 남는다
     (일지 탭에서 "N일째 · ₩6,600" 한 줄로 보인다).
     { day, total, depth, lines: [{ t:'fact'|'feel'|'story'|'reward', s:'…' }] } */
  journal: [],
  /* 직전에 쓴 문장 id — 연속 중복을 막는다 */
  lastJournal: { fact: '', feel: '', story: '' },
  /* 살림을 산 직후 세팅. 다음 물때 일지 끝에 보상 문장 1줄을 붙이고 비운다 */
  pendingHomeReward: '',
  /* ★ 일지용 — 한 번이라도 들어가 본 바당(key). '여'는 시작부터 열려 있어
     "해금되고 처음"이 아니므로 game.js 에서 rank!=='hagun' 인 바당만 기록한다. */
  visitedBadang: {},
  /* 실측 통계 — 페이싱 검증용 (디버그 패널 / 완료 보고에 씀) */
  stat: { playSec: 0, dives: 0, bestDepth: 0, earned: 0 }
};


/* ============================================================
   저장 — 실패해도 조용히
   ============================================================ */
function saveState(o) { try { localStorage.setItem('sumbi', JSON.stringify(o)); } catch (e) {} }
function loadState()  { try { return JSON.parse(localStorage.getItem('sumbi')); } catch (e) { return null; } }

var SAVE = {

  save: function () { saveState(PROGRESS); },

  load: function () {
    var s = loadState();
    if (!s || typeof s !== 'object') return false;
    /* 필드별로 옮긴다. 구버전 저장이 남아 있어도 죽지 않게 */
    if (typeof s.day === 'number') PROGRESS.day = s.day;
    if (typeof s.money === 'number') PROGRESS.money = s.money;
    if (RANK_INDEX[s.rank] !== undefined) PROGRESS.rank = s.rank;
    if (s.gear) for (var g in PROGRESS.gear) if (typeof s.gear[g] === 'number') PROGRESS.gear[g] = s.gear[g];
    if (s.home) for (var h in PROGRESS.home) PROGRESS.home[h] = !!s.home[h];
    if (s.homeState) for (var hs in PROGRESS.homeState) {
      if (s.homeState[hs] === 'hidden' || s.homeState[hs] === 'hinted' || s.homeState[hs] === 'known') {
        PROGRESS.homeState[hs] = s.homeState[hs];
      }
    }
    if (s.tideSinceHint) for (var th in PROGRESS.tideSinceHint) {
      if (typeof s.tideSinceHint[th] === 'number') PROGRESS.tideSinceHint[th] = s.tideSinceHint[th];
    }
    if (s.dex) for (var d in s.dex) if (SPECIES_BY_ID[d]) PROGRESS.dex[d] = true;
    PROGRESS.firstGearBought = !!s.firstGearBought;
    PROGRESS.lantern = !!s.lantern;
    PROGRESS.endingSeen = !!s.endingSeen;
    PROGRESS.seenHowto = !!s.seenHowto;
    if (Object.prototype.toString.call(s.journal) === '[object Array]') {
      PROGRESS.journal = [];
      for (var ji = 0; ji < s.journal.length; ji++) {
        var je = s.journal[ji];
        if (!je || typeof je.day !== 'number') continue;
        var lines = [];
        if (Object.prototype.toString.call(je.lines) === '[object Array]') {
          for (var li = 0; li < je.lines.length; li++) {
            var ln = je.lines[li];
            if (ln && typeof ln.s === 'string') lines.push({ t: String(ln.t || 'fact'), s: ln.s });
          }
        }
        PROGRESS.journal.push({
          day: je.day,
          total: typeof je.total === 'number' ? je.total : 0,
          depth: typeof je.depth === 'number' ? je.depth : 0,
          lines: lines
        });
      }
    }
    if (s.lastJournal) for (var lj in PROGRESS.lastJournal) {
      if (typeof s.lastJournal[lj] === 'string') PROGRESS.lastJournal[lj] = s.lastJournal[lj];
    }
    if (typeof s.pendingHomeReward === 'string') PROGRESS.pendingHomeReward = s.pendingHomeReward;
    if (s.visitedBadang && typeof s.visitedBadang === 'object') {
      PROGRESS.visitedBadang = {};
      for (var vb = 0; vb < BADANG.length; vb++) {
        var vk = BADANG[vb].key;
        if (s.visitedBadang[vk]) PROGRESS.visitedBadang[vk] = true;
      }
    }
    if (s.stat) for (var k in PROGRESS.stat) if (typeof s.stat[k] === 'number') PROGRESS.stat[k] = s.stat[k];
    return true;
  },

  exists: function () { return !!loadState(); },

  reset: function () {
    PROGRESS.day = 1; PROGRESS.money = 0; PROGRESS.rank = 'hagun';
    PROGRESS.gear = { tewak:1, mangsari:1, muloht:1 };
    PROGRESS.home = { pot:false, books:false, field:false };
    PROGRESS.homeState = { pot:'hidden', books:'hidden', field:'hidden' };
    PROGRESS.tideSinceHint = { pot:0, books:0, field:0 };
    PROGRESS.dex = {};
    PROGRESS.firstGearBought = false; PROGRESS.lantern = false;
    PROGRESS.endingSeen = false;
    PROGRESS.journal = [];
    PROGRESS.lastJournal = { fact:'', feel:'', story:'' };
    PROGRESS.pendingHomeReward = '';
    PROGRESS.visitedBadang = {};
    PROGRESS.stat = { playSec:0, dives:0, bestDepth:0, earned:0 };
    try { localStorage.removeItem('sumbi'); } catch (e) {}
  }
};


/* ============================================================
   장비에서 파생되는 실제 수치
   ★ 여기가 8-4 검산표의 입력값입니다.
   ============================================================ */
var STATS = {
  o2Max:       function () { return GEAR_STATS.muloht.o2Max[PROGRESS.gear.muloht - 1]; },
  weightMax:   function () { return GEAR_STATS.mangsari.weightMax[PROGRESS.gear.mangsari - 1]; },
  ascendPenalty: function () { return GEAR_STATS.mangsari.penalty[PROGRESS.gear.mangsari - 1]; },
  ascendBase:  function () { return GEAR_STATS.tewak.ascendBase[PROGRESS.gear.tewak - 1]; }
};


/* ============================================================
   장비 구매
   ============================================================ */
function gearPrice(id, lv) { return GEAR_BY_ID[id].price[lv - 1]; }

function canBuyGear(id, lv) {
  var cur = PROGRESS.gear[id];
  if (lv !== cur + 1) return false;          /* 순차 구매만 */
  if (lv > 3) return false;
  return PROGRESS.money >= gearPrice(id, lv);
}

function buyGear(id, lv) {
  if (!canBuyGear(id, lv)) return false;
  PROGRESS.money -= gearPrice(id, lv);
  PROGRESS.gear[id] = lv;
  PROGRESS.firstGearBought = true;           /* ★ 살림 공개 트리거의 조건 */
  SAVE.save();
  return true;
}


/* ============================================================
   살림 — 불턱 배경의 빈자리. 팝업이 아니라 환경 기반 발견.

   hidden → hinted → known 3단계.
   순차 공개는 그대로 유지된다: 솥을 사야 책 자리가 hinted 로 넘어가고,
   책을 사야 밭 자리가 hinted 로 넘어간다.
   ============================================================ */

/* i 번째 자리가 hidden 을 벗어날 조건.
   ★ 이제 장비 구매가 아니라 "일차"가 조건이다 — 일지의 서사 문장(JOURNAL_STORY_DAYS)이
     먼저 사연을 말하고, 그 다음 물때부터 자리가 hinted 로 열린다.
     사연이 물건보다 먼저 온다. 순차성은 일차 순서(3 → 6 → 10)가 보장한다. */
function homeUnlockCond(i) {
  var id = HOME_ORDER[i];
  for (var k = 0; k < JOURNAL_STORY_DAYS.length; k++) {
    if (JOURNAL_STORY_DAYS[k].hint === id) return PROGRESS.day >= JOURNAL_STORY_DAYS[k].day;
  }
  return false;
}

/* 조건이 찬 자리를 hidden → hinted 로 넘긴다.
   ★ 팝업도 대사도 띄우지 않는다 — 반짝임과 시선 연출만 트리거하면 된다.
     불턱 진입 시, 그리고 장비/살림 구매 직후 호출한다. 새로 hinted 된 id 배열을 돌려준다. */
function checkHomeHints() {
  var justHinted = [];
  for (var i = 0; i < HOME_ORDER.length; i++) {
    var id = HOME_ORDER[i];
    if (PROGRESS.homeState[id] !== 'hidden') continue;
    if (homeUnlockCond(i)) { PROGRESS.homeState[id] = 'hinted'; justHinted.push(id); }
  }
  if (justHinted.length) SAVE.save();
  return justHinted;
}


/* ============================================================
   해녀 일지 — 물때 1회마다 항목 1개
   ★ 정산 오버레이 안에서 같이 보여줍니다(추가 클릭 0회).
   ★ 문장이 없는 날이 있어야 매일 나오는 피로가 안 생깁니다.
   ============================================================ */

/* 한글 목적격 조사 — 받침이 있으면 '을', 없으면 '를'.
   "문어을(를)" 같은 표기가 나오지 않게 한다. */
function objParticle(word) {
  var last = word.charCodeAt(word.length - 1);
  if (last < 0xAC00 || last > 0xD7A3) return '를';       /* 한글이 아니면 기본값 */
  return ((last - 0xAC00) % 28) ? '을' : '를';
}

/* 직전에 쓴 것과 겹치지 않게 뽑는다. 후보가 하나뿐이면 그냥 그것을 쓴다. */
function pickJournalLine(pool, kind) {
  var last = PROGRESS.lastJournal[kind];
  var cand = [];
  for (var i = 0; i < pool.length; i++) if (pool[i].id !== last) cand.push(pool[i]);
  if (!cand.length) cand = pool;
  var p = cand[Math.floor(Math.random() * cand.length)];
  PROGRESS.lastJournal[kind] = p.id;
  return p.s;
}

/* ctx: { total, depth, reason, mulsum, newDex[], deepest }
   반환: 방금 만든 일지 항목(오버레이가 바로 렌더할 수 있게). */
function buildJournalEntry(ctx) {
  var lines = [];
  var day = PROGRESS.day;

  /* 1) 이 일차의 고정 서사 — 살림 자리를 여는 사연 */
  var storyDay = null;
  for (var i = 0; i < JOURNAL_STORY_DAYS.length; i++) {
    if (JOURNAL_STORY_DAYS[i].day === day) { storyDay = JOURNAL_STORY_DAYS[i]; break; }
  }

  /* 2) 확률과 무관하게 문장이 나와야 하는 날인가 */

  /* ★ 승급으로 막 해금된 바다에 이번이 첫 입수 — game.js 가 '여'(시작부터 열림)는
     제외하고 넘겨준다. */
  var firstBadangLine = ctx.firstBadang ? ('처음으로 ' + ctx.firstBadang + '에 들어가봤다.') : '';

  var forcedFact = '';
  if (ctx.reason === 'blackout') forcedFact = JOURNAL_FORCED.blackout;
  else if (ctx.mulsum)           forcedFact = JOURNAL_FORCED.mulsum;
  else if (ctx.deepest)          forcedFact = JOURNAL_FORCED.deepest;

  /* ★ 신규 도감 — 관찰 3종(돌고래·거북·쥐가오리)과의 첫 조우는 승급 조건이라
     의미가 다르므로 문구를 따로 쓴다. 한 물때에 여럿이 처음이어도(흔치 않지만)
     하루 일지가 길어지지 않게 하나만 고르되, 관찰종이 있으면 그걸 우선한다. */
  var newDexLine = '';
  if (ctx.newDex && ctx.newDex.length) {
    var chosenId = null;
    for (var ndi = 0; ndi < ctx.newDex.length; ndi++) {
      var spx = SPECIES_BY_ID[ctx.newDex[ndi]];
      if (spx && spx.kind === 'observe') { chosenId = ctx.newDex[ndi]; break; }
    }
    if (!chosenId) chosenId = ctx.newDex[0];
    var sp = SPECIES_BY_ID[chosenId];
    if (sp) {
      newDexLine = sp.kind === 'observe'
        ? ('처음으로 ' + sp.name + objParticle(sp.name) + ' 만났다.')
        : (sp.name + objParticle(sp.name) + ' 처음 봤다.');
    }
  }

  var forced = !!(storyDay || firstBadangLine || forcedFact || newDexLine || PROGRESS.pendingHomeReward);

  if (storyDay) {
    lines.push({ t: 'story', s: storyDay.s });
  }
  if (firstBadangLine) lines.push({ t: 'fact', s: firstBadangLine });
  if (forcedFact) lines.push({ t: 'fact', s: forcedFact });
  if (newDexLine) lines.push({ t: 'fact', s: newDexLine });

  if (forced) {
    /* 확정 사건이 있는 날 — 사실 뒤에 감상 1줄만 덧붙인다(서사날은 그 자체로 충분) */
    if (!storyDay) lines.push({ t: 'feel', s: pickJournalLine(JOURNAL_FEELS, 'feel') });
  } else {
    /* 평범한 날 — 35% 없음 / 50% 사실+감상 / 15% 서사 */
    var r = Math.random();
    if (r < 0.35) {
      /* 문장 없음 — 장부만 */
    } else if (r < 0.85) {
      lines.push({ t: 'fact', s: pickJournalLine(JOURNAL_FACTS, 'fact') });
      lines.push({ t: 'feel', s: pickJournalLine(JOURNAL_FEELS, 'feel') });
    } else {
      lines.push({ t: 'story', s: pickJournalLine(JOURNAL_STORY, 'story') });
    }
  }

  /* 3) 살림을 산 다음 물때의 보상 문장 — 항상 맨 끝 */
  if (PROGRESS.pendingHomeReward) {
    var rw = JOURNAL_REWARD[PROGRESS.pendingHomeReward];
    if (rw) lines.push({ t: 'reward', s: rw });
    PROGRESS.pendingHomeReward = '';
  }

  var entry = { day: day, total: ctx.total || 0, depth: ctx.depth || 0, lines: lines };
  PROGRESS.journal.push(entry);
  SAVE.save();
  return entry;
}

/* hinted 상태에서 물때(다이빙)가 끝날 때마다 호출.
   2회째에도 여전히 hinted 면 안전망 대사를 1회 띄우고 다시는 반복하지 않는다.
   ★ known 으로 전환하지는 않는다 — 카드를 여는 건 여전히 플레이어의 클릭뿐. */
function tickHomeHintSafety() {
  var due = [];
  for (var i = 0; i < HOME_ORDER.length; i++) {
    var id = HOME_ORDER[i];
    if (PROGRESS.homeState[id] !== 'hinted') continue;
    if (PROGRESS.tideSinceHint[id] < 0) continue;   /* 이미 한 번 알렸다 */
    PROGRESS.tideSinceHint[id]++;
    if (PROGRESS.tideSinceHint[id] >= 2) {
      PROGRESS.tideSinceHint[id] = -1;
      due.push(id);
    }
  }
  if (due.length) SAVE.save();
  return due;
}

/* hinted 자리를 클릭했을 때 known 으로 연다. 이미 known/구매됐으면 false */
function openHomeCard(id) {
  if (PROGRESS.home[id] || PROGRESS.homeState[id] !== 'hinted') return false;
  PROGRESS.homeState[id] = 'known';
  SAVE.save();
  return true;
}

function canBuyHome(id) {
  return PROGRESS.homeState[id] === 'known' && !PROGRESS.home[id] && PROGRESS.money >= HOME_BY_ID[id].price;
}

function buyHome(id) {
  if (!canBuyHome(id)) return false;
  PROGRESS.money -= HOME_BY_ID[id].price;
  PROGRESS.home[id] = true;
  /* 다음 물때 일지 끝에 보상 문장 1줄 */
  PROGRESS.pendingHomeReward = id;
  SAVE.save();
  return true;
}


/* ============================================================
   승급 — 자판기가 아니라 마을의 인정.
   구매 버튼 없이 불턱 진입 시점에 자동으로 일어난다.
   ★ 도감이 조건에 들어간 것이 핵심입니다.
   ============================================================ */
function dexCount() {
  var n = 0;
  for (var k in PROGRESS.dex) if (PROGRESS.dex[k]) n++;
  return n;
}

function rankIdx() { return RANK_INDEX[PROGRESS.rank] || 0; }

function meetsRank(r) {
  if (!r.need) return false;
  var g = r.need.gear, k;
  for (k in g) if (PROGRESS.gear[k] < g[k]) return false;
  if (dexCount() < r.need.dex) return false;
  return true;
}

/* 다음 승급까지 남은 것 — 도감 화면과 바당 카드에 쓴다 */
function nextRank() {
  var i = rankIdx();
  return (i + 1 < RANKS.length) ? RANKS[i + 1] : null;
}

function rankShortfall() {
  var r = nextRank();
  if (!r) return null;
  var miss = [], k;
  for (k in r.need.gear) if (PROGRESS.gear[k] < r.need.gear[k]) miss.push(GEAR_BY_ID[k].name + ' Lv' + r.need.gear[k]);
  var d = r.need.dex - dexCount();
  if (d > 0) miss.push('도감 ' + d + '종');
  return { rank: r, miss: miss, dexLeft: Math.max(0, d) };
}

/* 불턱 진입 시 호출. 승급했으면 랭크 객체를, 아니면 null */
function checkPromotion() {
  var i = rankIdx();
  if (i + 1 >= RANKS.length) return null;
  var r = RANKS[i + 1];
  if (!meetsRank(r)) return null;
  PROGRESS.rank = r.id;
  if (r.grantLantern) PROGRESS.lantern = true;   /* 랜턴은 구매 항목이 아니다 */
  SAVE.save();
  return r;
}


/* ============================================================
   바당 해금 — 병렬 선택. 잠긴 것도 조건과 함께 보인다.
   ============================================================ */
function badangUnlocked(b) { return rankIdx() >= (RANK_INDEX[b.rank] || 0); }

function unlockedCount() {
  var n = 0, i;
  for (i = 0; i < BADANG.length; i++) if (badangUnlocked(BADANG[i])) n++;
  return n;
}


/* ============================================================
   도감
   ============================================================ */
/* 첫 조우 프레임 캡처는 캔버스 엘리먼트로 메모리에 들고 있는다.
   toDataURL 은 아트 PNG 를 file:// 로 그린 순간 캔버스가 tainted 되어
   예외를 던지므로 쓰지 않는다. */
var DEX_SHOTS = {};

function dexHas(id) { return !!PROGRESS.dex[id]; }

/* 새로 등록되면 true */
function dexRecord(id, shotCanvas) {
  if (PROGRESS.dex[id]) {
    if (shotCanvas && !DEX_SHOTS[id]) DEX_SHOTS[id] = shotCanvas;
    return false;
  }
  PROGRESS.dex[id] = true;
  if (shotCanvas) DEX_SHOTS[id] = shotCanvas;
  SAVE.save();
  return true;
}


/* ============================================================
   돈
   ============================================================ */
function addMoney(v) {
  PROGRESS.money += v;
  PROGRESS.stat.earned += v;
  SAVE.save();
}

function money() { return PROGRESS.money; }

function wonText(v) { return '₩ ' + Math.round(v).toLocaleString('ko-KR'); }
function numText(v) { return Math.round(v).toLocaleString('ko-KR'); }
