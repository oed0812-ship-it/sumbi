/* ============================================================
   숨비 (SUMBI) — config.js
   튜닝 단일 소스. 매직넘버는 전부 여기로 올린다.
   ★ 가시성/조명 값은 sumbi-lighting-spec.md 2절이 단일 출처.
     다른 파일에서 중복 정의하지 않는다.
   ============================================================ */
var SUMBI = SUMBI || {};

var CONFIG = {

  /* ── 화면 ── */
  VIEW_W: 960, VIEW_H: 600,
  PIXELS_PER_METER: 40,
  WORLD_WIDTH: 2200,
  TIDE_DURATION: 150,

  /* ── 산소 ── */
  O2_MAX: 100,
  O2_DRAIN_IDLE: 1.6, O2_DRAIN_MOVE: 2.4,
  O2_DRAIN_ASCEND: 3.0, O2_DRAIN_HARVEST: 4.0,
  O2_DEPTH_FACTOR: 0.032, O2_REFILL_TIME: 2.0,
  MULSUM_THRESHOLD: 24, MULSUM_BONUS: 2.2,

  /* ── 이동 ── */
  SPEED_HORIZONTAL: 2.4, SPEED_DESCEND: 2.8, SPEED_ASCEND_BASE: 2.2,

  /* ── 무게 ── */
  WEIGHT_MAX: 10.0, WEIGHT_ASCEND_PENALTY: 0.72,
  WEIGHT_MOVE_PENALTY: 0.30, WEIGHT_SINK_BIAS: 0.6,

  /* ── 카메라 ── */
  CHAR_HEIGHT_PCT: 0.09,
  CAM_ZOOM_NORMAL: 1.0, CAM_ZOOM_DEEP: 0.97,
  CAM_ZOOM_MULSUM: 2.0, CAM_ZOOM_SURFACE: 0.75,   /* ★ 아트 통합 후 재확인 (작업 순서 10) */
  CAM_FOLLOW_LERP: 0.12, CAM_LOOK_OFFSET: 0.10,
  /* ★ 해녀는 항상 화면 안에 있어야 한다 — 프레이밍(바이어스·룩어헤드)이
     무엇을 계산하든 최종적으로 화면 상/하 가장자리에서 이만큼은 떨어져 보이도록
     updateCamera() 에서 마지막에 한 번 더 조인다. */
  CAM_DIVER_MARGIN: 90,
  /* 다이빙 시작 연출 — 카메라가 평소보다 더 깊은 지점에서 시작해
     정착 위치까지 스스로 떠오르며 "물에서 떠오르는" 느낌을 낸다 (ui.js 다이빙 진입 참조) */
  DIVE_INTRO_RISE: 130,

  /* ── 수면 경계 / 깊이 연동 카메라 바이어스 ──
     ★ CAM_BIAS_TAU=2 는 테왁의 짧은 수면 대기(O2_REFILL_TIME=2초) 동안
       63%만 전환된다. 상승 중 수심이 REF_M 아래로 들어오면 CAM_BIAS_TAU_FAST 로
       임시 전환해 그 구간만 빠르게 따라잡는다 (game.js updateCamera 참조). */
  CAM_BIAS_SHALLOW: -0.34, CAM_BIAS_DEEP: 0.12,
  CAM_BIAS_REF_M: 4, CAM_BIAS_TAU: 2, CAM_BIAS_TAU_FAST: 0.35,

  /* ── 수면선 / 하늘 / 굴절 ── */
  HORIZON_OFFSET: 56,
  WAVE_AMP: 14.5, FOAM: 0.7, SUBSURF_GLOW: 0.7,
  REFRACT_BAND: 50, REFRACT_AMP: 5, REFRACT_SPEED: 1.2,

  /* ── 연출 ── */
  TIMESCALE_MULSUM: 0.6, TIMESCALE_ENCOUNTER: 0.4, TIMESCALE_EMERGE: 0.7,
  SURFACE_BAND_DURATION: 0.45,

  /* ── 오디오 ── */
  LOWPASS_SURFACE: 8000, LOWPASS_DEEP: 1040, LOWPASS_EMERGE_OPEN: 18000,
  MASTER_VOLUME: 0.5,

  /* ── 월드 ── */
  TEWAK_X: 380, TEWAK_RADIUS: 26, SURFACE_LINE_M: 0.5,
  HARVEST_RADIUS: 44, HARVEST_MOVE_CANCEL: 0.35,

  /* ── 채집물 배치 거리 / 간격 ──
     ★ CRITTER_DIST_NEAR_FRAC~FAR_FRAC 는 테왁 기준 도달 거리를 "그쪽 방향으로
       실제 쓸 수 있는 폭(room)의 비율"로 정한다 — 고정 px 값이 아니라 room 에
       비례해야, WORLD_WIDTH 가 넓어져도(아래 WIDEN 참조) 채집물이 테왁 근처에만
       몰리지 않고 전체 폭에 걸쳐 퍼진다. 가치가 높을수록 먼 쪽(FAR_FRAC 에 가깝게).
     ★ CRITTER_MIN_DIST 는 어떤 두 채집물도 이보다 가까이 놓지 않는 절대 최소
       간격, CRITTER_CLUSTER_RADIUS 안에는 CRITTER_CLUSTER_MAX 개까지만 허용한다.
       이 조건을 못 채우면 CRITTER_SPAWN_WIDEN 만큼 도달 거리를 늘려가며
       재시도하고, 그래도 안 되면 WORLD_WIDTH 자체를 늘린다(아래). */
  CRITTER_DIST_NEAR_FRAC: 0.14, CRITTER_DIST_FAR_FRAC: 0.92, CRITTER_DIST_JITTER: 130,
  CRITTER_MIN_DIST: 46, CRITTER_CLUSTER_RADIUS: 100, CRITTER_CLUSTER_MAX: 3,
  CRITTER_SPAWN_TRIES: 12, CRITTER_SPAWN_WIDEN: 70,
  /* ★ 테왁 기준 도달 거리를 늘려도 자리가 안 나면(=이 바당은 실제로 좁다는 뜻)
     WORLD_WIDTH 자체를 이만큼씩 늘린다. game.js generateStage 가 세션 중
     필요할 때만 올리고 되돌리지 않는다 — 더 넓은 세계가 문제될 건 없다. */
  WORLD_WIDTH_STEP: 300, WORLD_WIDTH_MAX: 3200,
  ENCOUNTER_RADIUS: 150, ENCOUNTER_HOLD: 1.5,
  BLACKOUT_RISE_SPEED: 2.2, BUBBLE_INTERVAL_BASE: 0.22,
  SHAKE_AMOUNT: 2.5, HEARTBEAT_START_PCT: 30,

  /* ── 조작 ── */
  FOLLOW_TAU_BASE: 0.28, FOLLOW_TAU_WEIGHT: 0.35,
  POINTER_FULL_DIST: 120, POINTER_DEADZONE: 10, DRAG_QUADRATIC: 0.45,
  ANGLE_TURN_RATE: 6.0, ANGLE_TURN_WEIGHT: 0.40,
  ANGLE_DEADZONE_SPEED: 0.35, ANGLE_IDLE_LERP: 1.2,
  SNAP_RADIUS_MULT: 1.5, SNAP_FORCE: 3.2, SNAP_ANGLE_TOL: 1.05,

  /* ============================================================
     가시성 / 조명 — sumbi-lighting-spec.md 2절 그대로
     ============================================================ */

  /* ── 가시성 보간 기준 ── */
  VIS_DEPTH_REF: 26,            /* ★ 스테이지 최대 수심이 아니라 전 스테이지 공통 절대값 */

  /* ── 1층 · 균일 감쇠 ── */
  DEPTH_ATTEN_MAX: 0.50,

  /* ── 2층 · 가시거리 마스크 ── */
  VIS_RADIUS_SHALLOW: 1000,     /* 수면 기준 반경(px). 화면 대각선 1132px */
  VIS_RADIUS_DEEP: 400,         /* 최대 수심 기준 */
  VIS_SOFTNESS: 0.48,           /* 낮을수록 경계가 부드러움 */
  VIS_TINT_ALPHA: 0.85,

  /* ── 3층 · 빛기둥 ── */
  LIGHT_SHAFT_COUNT: 2,
  LIGHT_SHAFT_WIDTH_SHALLOW: 270,
  LIGHT_SHAFT_WIDTH_DEEP: 50,
  LIGHT_SHAFT_ALPHA: 0.14,
  LIGHT_SHAFT_SWAY: 0.55,
  LIGHT_SHAFT_EDGE_SOFT: 0.85,  /* 0 = 딱 끊기는 면 / 1 = 완전히 퍼짐 */

  /* ── 채집물 반짝임 ── */
  GLINT_ALPHA: 0.55,
  GLINT_RADIUS: 30,

  /* ── 산소 저하 ── */
  O2_DESAT: 0.90,               /* 채도 소실 */
  O2_DARKEN: 0.34,              /* 전체 감광 */
  VIGNETTE_MAX: 0.55,           /* 보조. 높이면 중심이 밝아 보이는 착시 발생 */

  /* ── 랜턴 (바당 3) ── */
  LANTERN_RADIUS: 165,          /* 빛이 퍼지는 반경 */
  LANTERN_GLOW_ALPHA: 0.18,     /* ★ 밝기는 낮게 — 밝히는 도구가 아니라 색을 되돌리는 도구 */
  LANTERN_COLOR_RADIUS: 165,    /* 색 복원 반경 (밝기와 분리) */

  /* ============================================================
     채집 저항 — 3단계 손맛 시스템
     ============================================================ */
  HITSTOP_MS: 120,
  STAGE1_END: 0.55, STAGE2_END: 0.85,
  STAGE1_SPEED: 1.15, STAGE2_SPEED: 0.7, STAGE3_SPEED: 3.0,
  PULL_MULT: 1.0, PULL_WEIGHT: 0.45,
  KNOCKBACK: 6, CAM_KICK: 9,
  FLY_DURATION: 0.46, BAG_POP: 0.45,
  TIME_VARIANCE: 0.2, SLIP_CHANCE: 0.15,
  RETRY_TIME_MULT: 1.4, RETRY_PULL_MULT: 1.3,
  TREMBLE: 5, SAND_AMOUNT: 18,

  /* ============================================================
     수채화 질감 — #dbg 패널에서 튜닝해 확정한 값.
     WC_GRAIN_* : 정적 종이 그레인 오버레이 (#wcGrain, 캔버스 위에 겹치는
       별도 DOM 레이어라 매 프레임 다시 계산되지 않는다 — 사실상 공짜).
     WC_WARP_*  : #cv 자체에 feDisplacementMap 을 걸어 붓 번짐처럼 왜곡한다.
       SCALE 0 이면 켜져 있어도(WC_WARP_ON) 실제 왜곡은 없다 — 확정값 그대로.
     ============================================================ */
  WC_GRAIN_ON: 1, WC_GRAIN_FREQ: 0.45, WC_GRAIN_ALPHA: 0.72, WC_GRAIN_OPACITY: 0.24,
  WC_WARP_ON: 1, WC_WARP_FREQ: 0.02, WC_WARP_SCALE: 0,

  /* ============================================================
     ★ 제출 빌드에서는 반드시 false.
     false 이면 디버그 패널 DOM 생성과 `~` 키 핸들러 등록 자체를 건너뛴다.
     ============================================================ */
  DEV: true
};

/* 사용자 설정 (설정 화면에서 변경, localStorage 저장) */
var SETTINGS = {
  volMaster: 0.5,
  volSfx: 0.8,
  volBgm: 0.5,
  quality: 2           /* 0 저 / 1 중 / 2 고 */
};
