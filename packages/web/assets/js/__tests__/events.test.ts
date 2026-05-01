import { describe, it, expect, mock, beforeAll } from 'bun:test';
import { DETAIL_FILTER_CHANGED, FEED_UPDATED } from '../events.js';

// Bun 테스트 환경은 DOM이 없으므로 EventTarget 기반 document mock 제공
const eventTarget = new EventTarget();
const doc = {
  addEventListener:    eventTarget.addEventListener.bind(eventTarget),
  removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
  dispatchEvent:       eventTarget.dispatchEvent.bind(eventTarget),
};

describe('events.js 상수', () => {
  it('DETAIL_FILTER_CHANGED 값이 detail:filterChanged', () => {
    expect(DETAIL_FILTER_CHANGED).toBe('detail:filterChanged');
  });
  it('FEED_UPDATED 값이 feed:updated', () => {
    expect(FEED_UPDATED).toBe('feed:updated');
  });
});

describe('DETAIL_FILTER_CHANGED pub-sub', () => {
  it('detail:filterChanged 발행 시 구독자 콜백 호출', () => {
    const handler = mock(() => {});
    doc.addEventListener(DETAIL_FILTER_CHANGED, handler);
    doc.dispatchEvent(new CustomEvent(DETAIL_FILTER_CHANGED, {
      detail: { allTurns: [], flatFiltered: [] }
    }));
    expect(handler).toHaveBeenCalledTimes(1);
    doc.removeEventListener(DETAIL_FILTER_CHANGED, handler);
  });

  it('event.detail에 allTurns 포함 확인', () => {
    const turns = [{ turn_id: 't1' }];
    let received: any = null;
    const handler = (e: any) => { received = e.detail; };
    doc.addEventListener(DETAIL_FILTER_CHANGED, handler);
    doc.dispatchEvent(new CustomEvent(DETAIL_FILTER_CHANGED, {
      detail: { allTurns: turns }
    }));
    expect(received?.allTurns).toEqual(turns);
    doc.removeEventListener(DETAIL_FILTER_CHANGED, handler);
  });

  it('이중 발행 시 구독자 2회 호출', () => {
    const handler = mock(() => {});
    doc.addEventListener(DETAIL_FILTER_CHANGED, handler);
    doc.dispatchEvent(new CustomEvent(DETAIL_FILTER_CHANGED));
    doc.dispatchEvent(new CustomEvent(DETAIL_FILTER_CHANGED));
    expect(handler).toHaveBeenCalledTimes(2);
    doc.removeEventListener(DETAIL_FILTER_CHANGED, handler);
  });

  it('removeEventListener 후 콜백 호출 안 됨', () => {
    const handler = mock(() => {});
    doc.addEventListener(DETAIL_FILTER_CHANGED, handler);
    doc.removeEventListener(DETAIL_FILTER_CHANGED, handler);
    doc.dispatchEvent(new CustomEvent(DETAIL_FILTER_CHANGED));
    expect(handler).toHaveBeenCalledTimes(0);
  });
});
