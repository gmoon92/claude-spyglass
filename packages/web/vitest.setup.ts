// P5-07: 테스트 타임존을 UTC 로 고정한다.
//
// 이유: renderers 골든마스터(renderers.test.ts.snap)의 cell-time 필드는 fmtTime →
//   Date.prototype.toLocaleTimeString(timeZone 미지정) 로 렌더되어 프로세스 로컬 타임존에 의존한다.
//   기존 bun 골든마스터는 UTC 시각(예: "오전 10:01")으로 동결돼 있다(bun 런타임의 toLocaleTimeString
//   기본 렌더가 UTC 였던 결과). Node/jsdom 은 OS 로컬 타임존(예: KST → "오후 07:01")으로 렌더하므로,
//   TZ 를 UTC 로 고정하지 않으면 동일 코드가 머신/CI 로케일에 따라 다른 HTML 을 낸다.
//
//   TZ=UTC 고정 → (1) 기존 골든마스터와 byte 동치 보존, (2) 개발자 머신·CI 무관 결정론 확보.
//   setupFiles 는 각 테스트 워커에서 테스트 평가 전에 실행되므로 toLocaleTimeString 호출 시점에 적용된다.
process.env.TZ = 'UTC';
