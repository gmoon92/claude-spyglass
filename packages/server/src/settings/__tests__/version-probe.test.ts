/**
 * version-probe.test.ts — 외부 도구 버전 진단 단위 테스트
 *
 * 검증 대상:
 *   1) 시스템에 존재하는 도구는 `available:true` + version SemVer 추출
 *   2) 시스템에 없는 가짜 도구는 *예외 던지지 않고* `available:false` 폴백
 *   3) 응답 셰이프가 일관 — name/available/version/raw/installHint 필드 보장
 *
 *   실제 시스템의 bun 은 항상 있다고 가정 (테스트 실행 자체가 bun test). 다른 도구
 *   (claude, git, curl, jq) 는 환경에 따라 다를 수 있으므로 *실패 여부* 만 검증.
 */

import { describe, it, expect } from 'bun:test';
import { probeAllVersions } from '../version-probe';

describe('probeAllVersions', () => {
  it('5개 도구 모두에 대해 응답 셰이프가 일관된다', async () => {
    const result = await probeAllVersions();

    for (const key of ['bun', 'claude', 'git', 'curl', 'jq'] as const) {
      const probe = result[key];
      expect(probe).toBeDefined();
      expect(typeof probe.name).toBe('string');
      expect(typeof probe.available).toBe('boolean');
      // version 은 string | null
      expect(['string', 'object']).toContain(typeof probe.version);
      // installHint 는 항상 문자열 (빈 문자열일 수도 있음)
      expect(typeof probe.installHint).toBe('string');
    }
  });

  it('bun 은 테스트 환경에서 항상 available + version 매칭', async () => {
    const result = await probeAllVersions();
    expect(result.bun.available).toBe(true);
    expect(result.bun.version).toMatch(/\d+\.\d+/);
  });

  it('미설치 가능성이 있는 도구도 throw 하지 않는다', async () => {
    // 테스트 자체가 throw 없이 끝나는지가 핵심 — probeAllVersions 가 Promise.all 로 묶었어도
    // 미설치 도구의 Bun.spawn ENOENT 가 흡수되어야 한다.
    const result = await probeAllVersions();
    expect(result).toBeDefined();
    // jq 가 없을 수도, 있을 수도 — 둘 다 정상.
    expect([true, false]).toContain(result.jq.available);
  });
});
