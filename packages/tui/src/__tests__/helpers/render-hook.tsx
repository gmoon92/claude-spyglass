/**
 * render-hook.tsx — 특성화 테스트 전용 React 훅 호출 헬퍼.
 *
 * 소스 변경 없음. ink-testing-library 의 render 로 훅을 호출하는 작은
 * 컴포넌트를 마운트하고, 매 렌더의 반환값을 ref 박스에 기록한다.
 * (tool-row-alignment.test.ts 가 render 를 쓰는 것과 동일 계열 패턴.)
 *
 * 사용:
 *   const h = renderHook(() => useSessionTurns('http://x', 's1'));
 *   await flushAsync();
 *   expect(h.current.turns).toEqual([...]);
 *   h.unmount();
 */

import { render } from 'ink-testing-library';
import { Text } from 'ink';

export type HookHandle<T> = {
  /** 가장 최근 렌더의 훅 반환값. */
  readonly current: T;
  unmount: () => void;
};

export function renderHook<T>(useHook: () => T): HookHandle<T> {
  const box: { current: T } = { current: undefined as unknown as T };

  function Probe(): JSX.Element {
    box.current = useHook();
    return <Text>x</Text>;
  }

  const { unmount } = render(<Probe />);
  return {
    get current() {
      return box.current;
    },
    unmount,
  };
}
