import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// P1-01: Vite/React 빌드·HMR 파이프라인 동작 검증용 최소 마운트 포인트.
// 실제 컴포넌트/스토어/라우팅은 후속 task(P1-04 이후)에서 작성한다.
const container = document.getElementById('react-root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <div data-testid="react-mount-placeholder">Spyglass React migration scaffold</div>
    </StrictMode>
  );
}
