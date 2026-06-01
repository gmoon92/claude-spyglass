/**
 * system-prompt-detail-modal.test.tsx — System Prompt 본문 상세 모달 계약 검증 (P3 결함 #2)
 *
 * 원본: assets/js/system-prompt-library.js#showDetailModal/renderModalShell.
 * 셀렉터 계약(syslib-detail-modal/syslib-detail-inner/syslib-detail-close/data-syslib-close/
 *   syslib-detail-head/syslib-detail-hash/syslib-detail-content) + 상태 분기(loading/error/not-found/content) 검증.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SystemPromptDetailModal } from '../SystemPromptDetailModal';

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.I18n = { t: (k: string) => k };
});

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};

describe('SystemPromptDetailModal — 표시/숨김', () => {
  it('hash 없으면 null (모달 미표시)', () => {
    const out = html(
      <SystemPromptDetailModal hash={null} loading={false} detail={null} onClose={noop} />,
    );
    expect(out).toBe('');
  });

  it('hash 있으면 syslib-detail-modal 컨테이너 + role=dialog', () => {
    const out = html(
      <SystemPromptDetailModal hash="abc123" loading detail={null} onClose={noop} />,
    );
    expect(out).toContain('id="sysLibDetailModal"');
    expect(out).toContain('class="syslib-detail-modal"');
    expect(out).toContain('role="dialog"');
  });
});

describe('SystemPromptDetailModal — 상태 분기', () => {
  it('content 있으면 head(hash/size/seg/ref) + 본문 pre + 닫기 버튼', () => {
    const out = html(
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
        onClose={noop}
      />,
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
    const out = html(
      <SystemPromptDetailModal hash="abc" loading={false} detail={null} onClose={noop} />,
    );
    expect(out).toContain('ui.syslib.not-found');
    expect(out).toContain('data-syslib-close');
  });

  it('error → modal-load-failed', () => {
    const out = html(
      <SystemPromptDetailModal hash="abc" loading={false} detail={null} error="HTTP 500" onClose={noop} />,
    );
    expect(out).toContain('ui.syslib.modal-load-failed');
  });
});
