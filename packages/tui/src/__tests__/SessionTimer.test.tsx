/** @jsxImportSource react */
import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { SessionTimer } from '../components/SessionTimer';

describe('SessionTimer', () => {
  it('HH:MM:SS 포맷으로 렌더', () => {
    const startedAt = Date.now() - 5000; // 5초 전
    const { lastFrame } = render(<SessionTimer startedAt={startedAt} />);
    expect(lastFrame()).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('endedAt 있으면 고정 경과 시간 표시 — 90초 = 00:01:30', () => {
    const startedAt = 1_000_000_000_000;
    const endedAt = startedAt + 90_000;
    const { lastFrame } = render(<SessionTimer startedAt={startedAt} endedAt={endedAt} />);
    expect(lastFrame()).toContain('00:01:30');
  });

  it('endedAt 있으면 초 단위 경과가 정확히 계산됨 — 3661초 = 01:01:01', () => {
    const startedAt = 1_000_000_000_000;
    const endedAt = startedAt + 3_661_000;
    const { lastFrame } = render(<SessionTimer startedAt={startedAt} endedAt={endedAt} />);
    expect(lastFrame()).toContain('01:01:01');
  });

  it('unmount 시 에러 없이 정상 종료', () => {
    const { unmount, lastFrame } = render(<SessionTimer startedAt={Date.now() - 1000} />);
    expect(lastFrame()).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(() => unmount()).not.toThrow();
  });
});
