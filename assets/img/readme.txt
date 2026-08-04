숨비 — assets/img

여기에 아래 이름으로 PNG 또는 SVG 를 넣으면 코드가 자동으로 잡습니다
(PNG 를 먼저 찾고, 없으면 같은 이름의 SVG 를 찾습니다).
파일이 없으면 도형 폴백으로 그려지므로, 하나씩 넣어가며 확인할 수 있습니다.
적용 방식은 readme.md 5절을 보세요.

★ 해녀 / 관찰 3종은 "관절" 단위로 쪼갠 조각입니다.
  통짜 이미지 한 장이 아니라, 지금도 움직이는 부위(팔 · 발차기 · 지느러미 ·
  꼬리 등)마다 별도 파일입니다. 흰색 실루엣으로 만들면 스테이지 색이
  자동으로 입혀집니다(RENDER.tint). 각 조각의 정확한 피벗(회전 기준점)과
  viewBox 규격은 js/render.js 의 HAE_*, DOLPHIN_*, TURTLE_*, RAY_* 상수와
  그 위 주석에 문서화되어 있습니다 — 새 아트를 그릴 때 그 상수를 그대로
  참고해서 같은 좌표계(원점·피벗 위치)로 그려야 애니메이션이 어긋나지
  않습니다. 조각 하나만 비어 있어도 그 부위만 자동으로 벡터 도형 폴백됩니다.

해녀 (오른쪽 향한 기준 자세)
  hae_torso  — 몸통(팔·머리 제외)
  hae_head   — 머리(물안경 제외, 몸통에 고정 부착)
  hae_arm    — 팔 1개, 어깨 피벗 기준 (+x 가 기본 방향)
  hae_leg    — 다리(허벅지~발목), 엉덩이 피벗 기준 (+x 가 기본 방향,
               발차기마다 엉덩이~발목 거리에 맞춰 가로로 늘어남/줄어듬)
  hae_fin    — 오리발, 발목 피벗 기준 (발차기마다 이동/회전)
  hae_bag    — 망사리, 중심 기준 (무게에 따라 스케일)

채집 생물 9종 (512x512, 통짜 이미지 — 이미 완료됨)
  cr_bomal  cr_miyeok  cr_sora  cr_seonggae  cr_haesam
  cr_obunjagi  cr_munuh  cr_jeonbok  cr_dolge

관찰 생물 3종 (관절 조각)
  ob_dolphin_body  ob_dolphin_tail   — 돌고래 몸통 / 꼬리(살짝 흔들림)
  ob_turtle_body   ob_turtle_flipper — 거북 등딱지+머리+꼬리 / 앞지느러미 1장(위아래 재사용)
  ob_ray_hub       ob_ray_wing       — 쥐가오리 몸통중심+코+꼬리 / 날개 1장(위아래 재사용, 파닥임)

환경
  kelp_0  kelp_1  kelp_2
  rock_0  rock_1  rock_2  rock_3  rock_4
  bg_sky  bg_far  bg_near
  tewak

불턱 + 살림 레이어 3장
  bulteok  home_pot  home_books  home_field

로고
  logo_title       (넣으면 타이틀 텍스트 로고가 자동으로 이미지로 바뀝니다)

주의
  - 파일명은 전부 소문자. 한글/공백 금지
  - 기울기로 산소를 표현하지 말 것 (몸이 진행 방향으로 360도 회전함)
  - 전체 합계 3MB 이하
