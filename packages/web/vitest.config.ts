import { mergeConfig, defineConfig } from 'vitest/config';
import viteConfig from './vite.config';

// P5-07: 워커 fork 전에 프로세스 TZ 를 UTC 로 고정 → 워커가 UTC 를 상속한다.
//   (renderers 골든마스터 cell-time 의 toLocaleTimeString 타임존 의존 제거 — vitest.setup.ts 주석 참조.)
process.env.TZ = 'UTC';

// P5-07: 테스트 러너 bun test → Vitest 전환(Vite 생태계 통일, 단계적 전환의 마지막).
//   - vite.config.ts 를 mergeConfig 로 계승 → React plugin·base·resolve 규칙을 dev/build 와 동일하게 공유.
//     (테스트 환경에서 프록시·정적 자산 외부화 plugin 은 무해하게 inert: transformIndexHtml/closeBundle 은
//      Vitest 모듈 변환 경로에서 발화하지 않음.)
//   - 환경: jsdom. web 테스트 78파일 중 31파일이 document/window/localStorage 에 의존 → 전역 jsdom 필요.
//   - 직렬화 차이(Bun snapshot ↔ Vitest snapshot): renderers.test.ts 의 골든마스터 .snap 은 P5-07 에서
//     동일 입력으로 1회 재생성하고 HTML payload diff 0(출력 동치) 을 입증한다(헤더/래퍼만 포맷 변경).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // 명시적 import('vitest') 를 쓰므로 globals 는 불필요하나, 향후 호환·이식성을 위해 켠다.
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      include: [
        'assets/js/**/__tests__/**/*.test.{ts,tsx}',
        'assets/js/**/*.test.{ts,tsx}',
        'parseToolDetail.test.ts',
        'src/**/*.test.{ts,tsx}',
      ],
      // dist(운영 산출물)·node_modules 는 수집 대상에서 제외(bun test 와 동일 보루 범위 유지).
      exclude: ['node_modules/**', 'dist/**'],
    },
  })
);
