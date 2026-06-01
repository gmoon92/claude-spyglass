/**
 * react-element-walk.ts — 렌더 없이 React element 트리를 순회하는 테스트 워커.
 *
 * 배경: 일부 chrome 테스트는 renderToStaticMarkup 대신 element 트리를 직접 walk 해
 *   특정 노드(className 조각 등)를 찾고 onClick 등 핸들러를 직접 호출한다(경량 단언).
 *   함수 컴포넌트를 만나면 호출해 하위 트리를 펼친다.
 *
 * memo/forwardRef 인지(성능 최적화 후속): React.memo(fn)/forwardRef(fn) 로 감싼 컴포넌트는
 *   element.type 이 함수가 아니라 exotic 객체({$$typeof, type|render})다. 이를 내부 렌더 함수로
 *   언랩해 일반 함수 컴포넌트와 동일하게 펼친다 — 컴포넌트 메모화가 워커(=테스트 의도)를 깨지 않도록.
 *   (3개 chrome 테스트에 byte-동일하게 중복돼 있던 findFirst 를 단일 SSoT 로 통합.)
 *
 * @module test-support/react-element-walk
 */
import type { ReactElement } from 'react';

const MEMO = Symbol.for('react.memo');
const FORWARD_REF = Symbol.for('react.forward_ref');

/** memo/forwardRef exotic 을 내부 렌더 함수로 언랩. 일반 함수면 그대로, 아니면 null. */
function resolveRenderFn(type: unknown): ((props: unknown) => unknown) | null {
  if (typeof type === 'function') return type as (props: unknown) => unknown;
  if (type && typeof type === 'object') {
    const t = type as { $$typeof?: symbol; type?: unknown; render?: unknown };
    if (t.$$typeof === MEMO) return resolveRenderFn(t.type);
    if (t.$$typeof === FORWARD_REF && typeof t.render === 'function') {
      const render = t.render as (props: unknown, ref: unknown) => unknown;
      return (props: unknown) => render(props, null);
    }
  }
  return null;
}

/**
 * element 트리에서 pred 를 만족하는 첫 노드를 깊이우선 탐색. 함수/memo/forwardRef 컴포넌트는
 * 렌더 함수를 호출해 하위로 들어간다. 못 찾으면 null.
 */
export function findFirst(node: unknown, pred: (el: ReactElement) => boolean): ReactElement | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const c of node) {
      const r = findFirst(c, pred);
      if (r) return r;
    }
    return null;
  }
  const el = node as ReactElement & { type?: unknown; props?: Record<string, unknown> };
  if (el.props && pred(el)) return el;
  const renderFn = resolveRenderFn(el.type);
  if (renderFn) return findFirst(renderFn(el.props ?? {}), pred);
  if (el.props && el.props.children !== undefined) return findFirst(el.props.children, pred);
  return null;
}
