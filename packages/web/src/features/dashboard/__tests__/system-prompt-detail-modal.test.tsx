/**
 * system-prompt-detail-modal.test.tsx — System Prompt 본문 상세 모달 계약 검증 (P3 결함 #2)
 *
 * 원본: assets/js/system-prompt-library.js#showDetailModal/renderModalShell.
 * 셀렉터 계약(syslib-detail-modal/syslib-detail-inner/syslib-detail-close/data-syslib-close/
 *   syslib-detail-head/syslib-detail-hash/syslib-detail-content) + 상태 분기(loading/error/not-found/content) 검증.
 *
 * 렌더 방식: SystemPromptDetailModal 은 createPortal(document.body) 로 렌더되므로 renderToStaticMarkup(SSR)는
 *   "Portals are not supported by the server renderer" 로 실패한다. → jsdom 라이브 마운트(createRoot+act,
 *   use-tooltip.test 선례)로 전환하고, body 직속 모달 노드(#sysLibDetailModal)의 outerHTML 로 마크업 계약을
 *   단언한다(검증 의도 보존, 단언 약화 없음).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ensureDom } from '../../../test-support/ensure-dom';
import { SystemPromptDetailModal } from '../SystemPromptDetailModal';

ensureDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// i18n 은 useTranslation 직접 구독(self-subscribe). vitest.setup 기본 t 가 키 passthrough 라 raw 키 단언 유지.
const noop = () => {};

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

/** createPortal(document.body) → 모달은 body 직속. outerHTML 로 마크업 계약 검증(구 SSR out 대체). 미표시 시 ''. */
function renderModal(el: ReactElement): string {
  act(() => root.render(el));
  const modal = document.getElementById('sysLibDetailModal');
  return modal ? modal.outerHTML : '';
}

describe('SystemPromptDetailModal — 표시/숨김', () => {
  it('hash 없으면 null (모달 미표시)', () => {
    const out = renderModal(
      <SystemPromptDetailModal hash={null} loading={false} detail={null} onClose={noop} />,
    );
    expect(out).toBe('');
  });

  it('hash 있으면 syslib-detail-modal 컨테이너 + role=dialog', () => {
    const out = renderModal(
      <SystemPromptDetailModal hash="abc123" loading detail={null} onClose={noop} />,
    );
    expect(out).toContain('id="sysLibDetailModal"');
    expect(out).toContain('class="syslib-detail-modal"');
    expect(out).toContain('role="dialog"');
  });
});

describe('SystemPromptDetailModal — 상태 분기', () => {
  it('content 있으면 head(hash/size/seg/ref) + 본문 pre + 닫기 버튼', () => {
    const out = renderModal(
      <SystemPromptDetailModal
        hash="hash-full-0001"
        loading={false}
        detail={{
          hash: 'hash-full-0001',
          content: 'You are a helpful assistant.',
          byte_size: 2048,
          segment_count: 3,
          ref_count: 5,
        }}
        onClose={noop} />,
    );
    expect(out).toContain('syslib-detail-inner');
    expect(out).toContain('class="syslib-detail-hash"');
    expect(out).toContain('hash-full-0001');
    expect(out).toContain('2.0 KB'); // formatBytes
    expect(out).toContain('seg=3');
    expect(out).toContain('ref=5');
    expect(out).toContain('syslib-detail-content');
    expect(out).toContain('You are a helpful assistant.');
    // 닫기 버튼 계약(data-syslib-close + syslib-detail-close).
    expect(out).toContain('data-syslib-close');
    expect(out).toContain('syslib-detail-close');
  });

  it('detail 없음(fetch 완료) → not-found', () => {
    const out = renderModal(
      <SystemPromptDetailModal hash="abc" loading={false} detail={null} onClose={noop} />,
    );
    expect(out).toContain('ui:syslib.not-found');
    expect(out).toContain('data-syslib-close');
  });

  it('error → modal-load-failed', () => {
    const out = renderModal(
      <SystemPromptDetailModal hash="abc" loading={false} detail={null} error="HTTP 500" onClose={noop} />,
    );
    expect(out).toContain('ui:syslib.modal-load-failed');
  });
});
