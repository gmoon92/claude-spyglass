/**
 * use-capabilities.test.tsx — 특성화 테스트 (소스 변경 없음, 현재 동작 고정).
 *
 * useCapabilities 훅 + CapabilitiesProvider 의 현재 동작을 고정한다.
 *   - Provider value 가 주어지면 그대로 노출 (detect() 무시)
 *   - Provider 가 value 없이 감싸면 detect() 폴백으로 채워짐
 *   - Provider 가 전혀 없으면 (context=null) 훅이 detect() 직접 호출
 *   - 중첩 Provider 시 가장 안쪽 value 가 우선
 *
 * Provider 래핑은 renderHook 의 useHook 클로저 안에서 React tree 를 직접
 * 구성할 수 없으므로(renderHook 은 Probe 만 마운트), ink-testing-library 의
 * render 로 Provider→Probe 트리를 마운트하고 box 에 훅 반환값을 기록한다.
 */

import { describe, it, expect } from 'bun:test';
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { CapabilitiesProvider, useCapabilities } from '../hooks/useCapabilities';
import type { Capabilities } from '../lib/capabilities';

/** Provider 트리 안에서 useCapabilities() 반환값을 box 에 잡아 반환한다. */
function captureWithin(tree: (probe: JSX.Element) => JSX.Element): Capabilities {
  const box: { current: Capabilities | null } = { current: null };
  function Probe(): JSX.Element {
    box.current = useCapabilities();
    return <Text>x</Text>;
  }
  const { unmount } = render(tree(<Probe />));
  unmount();
  return box.current as Capabilities;
}

/** 명시적 Capabilities 값(detect() 결과와 절대 헷갈리지 않도록 극단값). */
const explicitCaps: Capabilities = {
  truecolor: true,
  unicode: true,
  braille: true,
  emoji: true,
  colors: 16777216,
  motion: false,
};

describe('useCapabilities — Provider value 주입', () => {
  it('Provider value 가 그대로 노출된다', () => {
    const caps = captureWithin((probe) => (
      <CapabilitiesProvider value={explicitCaps}>{probe}</CapabilitiesProvider>
    ));
    expect(caps).toEqual(explicitCaps);
    // motion=false 같은 비-default 값이 detect() 로 덮이지 않았음을 확인.
    expect(caps.motion).toBe(false);
  });
});

describe('useCapabilities — Provider 가 value 없이 감쌀 때', () => {
  it('detect() 폴백 결과(올바른 shape)를 노출한다', () => {
    const caps = captureWithin((probe) => (
      <CapabilitiesProvider>{probe}</CapabilitiesProvider>
    ));
    expect(typeof caps.truecolor).toBe('boolean');
    expect(typeof caps.unicode).toBe('boolean');
    expect(typeof caps.braille).toBe('boolean');
    expect(typeof caps.emoji).toBe('boolean');
    expect(typeof caps.motion).toBe('boolean');
    expect([16, 256, 16777216]).toContain(caps.colors);
  });
});

describe('useCapabilities — Provider 없음 (context=null)', () => {
  it('훅이 detect() 를 직접 호출해 올바른 shape 를 반환한다', () => {
    const box: { current: Capabilities | null } = { current: null };
    function Probe(): JSX.Element {
      box.current = useCapabilities();
      return <Text>x</Text>;
    }
    const { unmount } = render(<Probe />);
    const caps = box.current as Capabilities;
    unmount();
    expect([16, 256, 16777216]).toContain(caps.colors);
    expect(typeof caps.motion).toBe('boolean');
  });
});

describe('useCapabilities — 중첩 Provider', () => {
  it('가장 안쪽 Provider value 가 우선한다', () => {
    const outer: Capabilities = { ...explicitCaps, colors: 256, motion: true };
    const inner: Capabilities = { ...explicitCaps, colors: 16, motion: false };
    const caps = captureWithin((probe) => (
      <CapabilitiesProvider value={outer}>
        <CapabilitiesProvider value={inner}>{probe}</CapabilitiesProvider>
      </CapabilitiesProvider>
    ));
    expect(caps.colors).toBe(16);
    expect(caps.motion).toBe(false);
  });
});
