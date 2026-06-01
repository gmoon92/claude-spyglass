// i18n(태스크 #12) — react-i18next 인스턴스를 테스트 워커에서 초기화한다(useTranslation 사용 컴포넌트
//   테스트 지원). jsdom 에는 /locales 서버가 없어 백엔드 fetch 가 실패→빈 리소스→키 폴백을 반환하므로,
//   기존 골든 단언(키 passthrough; window.I18n stub `t:(k)=>k` 와 동치)이 변환 후에도 그대로 통과한다.
//   (import 부수효과로 i18next.init 발화 — Phase C 변환 컴포넌트가 useTranslation 으로 인스턴스 참조.)
import { i18next } from './src/lib/i18n';

// 테스트 한정 — i18next 의 t/getFixedT 를 레거시 window.I18n.t(테스트 stub) 로 **완전 위임**한다(vars 포함).
//   목적: 골든/특성/동치 테스트가 바닐라(window.I18n) ↔ TSX(useTranslation) 를 비교하므로, 두 경로의
//   i18n 출처를 테스트에서 일치시킨다. window.I18n 부재 시 key 폴백. 프로덕션 i18n.ts 는 무영향(여기서만 패치).
//   window.I18n 은 각 테스트 beforeAll 에서 세팅되므로, 위임 함수는 호출(렌더) 시점에 lazy 조회한다.
{
  const delegate = (key: unknown, opts?: unknown): string => {
    const legacy = (globalThis as { window?: { I18n?: { t?: (k: string, v?: unknown) => string } } }).window?.I18n;
    const k = Array.isArray(key) ? String(key[0]) : String(key);
    return legacy?.t ? legacy.t(k, opts as never) : k;
  };
  (i18next as unknown as { t: unknown }).t = delegate;
  (i18next as unknown as { getFixedT: unknown }).getFixedT = () => delegate;
}

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

// ── Node 22.4+/25 네이티브 webstorage 차폐 해소 ──
//
// 이유: Node 22.4+ 는 `--experimental-webstorage` 기능으로 전역 `localStorage`/`sessionStorage` 를
//   lazy getter(configurable) 로 globalThis 에 선점 정의한다. 이 getter 는 `--localstorage-file`
//   플래그 없이 접근하면 `SecurityError: Cannot initialize local storage without a --localstorage-file
//   path` 를 던지며, vitest 의 jsdom 환경이 깔아 둔 localStorage 를 가린다(globalThis === window 라
//   window.localStorage 접근도 동일하게 throw). → 24개 모듈이 의존하는 storage 테스트가 호스트 Node
//   버전에 따라 전부 실패하거나(Node 22.4+) 통과(Node 20)하는 비결정성이 생긴다.
//
//   해소: getter 가 configurable 이므로 결정론적 in-memory Storage 로 재정의한다. TZ 고정과 동일한
//   "개발자 머신·CI 무관 결정론" 범주의 테스트 인프라 보정이다(검증 의도 보존, 단언 약화 없음).
class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value));
  }
  [name: string]: unknown;
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: new MemoryStorage(),
  });
}
