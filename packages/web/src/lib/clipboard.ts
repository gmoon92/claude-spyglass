/**
 * lib/clipboard.ts — navigator.clipboard 복사 헬퍼 (P2-06)
 *
 * 원본: settings-view.js copyToClipboard(:1570-1577). 토스트 부수효과는 호출처가 주입한
 *   notify 콜백으로 분리(무전역 — 토스트 마운트는 React 호스트가 담당, 원본 toast() 직접호출 대체).
 *   성공/실패 모두 notify 호출(원본 :1573,1575).
 */

/**
 * 텍스트를 클립보드에 복사. 성공/실패를 notify 로 통지(원본 toast 대체).
 * @param text       복사 대상
 * @param notify     결과 라벨 통지 콜백(호출처가 Toast 마운트)
 * @param successLabel 성공 라벨(미지정 'Copied')
 */
export async function copyToClipboard(
  text: string,
  notify: (label: string) => void,
  successLabel = 'Copied',
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify(successLabel);
  } catch {
    notify('Copy failed');
  }
}
