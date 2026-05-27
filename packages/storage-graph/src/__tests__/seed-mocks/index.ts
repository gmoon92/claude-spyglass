/**
 * seed-mocks/index.ts — Mock 시드 패키지 entry
 *
 * 책임:
 *   세트 A/B/C 시드 함수와 MockLadybugClient 팩토리를 barrel 로 묶어 테스트가 한 줄
 *   import 로 사용하도록 제공한다.
 *
 * 의존성:
 *   - mock-client.ts (MockLadybugClient + createMockClient)
 *   - set-a-refactor.ts / set-b-deep-hierarchy.ts / set-c-wide-breadth.ts
 *
 * 호출 흐름:
 *   sequential-flow.test.ts
 *     → const client = createMockClient();
 *     → seedSetA(client);  // 세트별 시드 1개 선택
 *     → const result = await getSequentialFlow(client, { centerKind, centerName, depth });
 *     → expect(result.nodes / edges / layers) ...
 *
 * 디자인 결정:
 *   - 시드 함수는 *동기* — 테스트 setup 단순화. mock client 가 async query 만 비동기.
 *   - 각 세트 시드는 독립 ID 공간 (A=1000번, B=2000번, C=3000번) — 두 세트를 한 client
 *     에 동시에 심어도 충돌 없음 (실제 테스트는 세트별 격리 권장).
 */

export { MockLadybugClient, createMockClient } from './mock-client';
export { seedSetA, META_DOC_IDS_A, TOOL_USE_IDS_A } from './set-a-refactor';
export { seedSetB, META_DOC_IDS_B, TOOL_USE_IDS_B } from './set-b-deep-hierarchy';
export { seedSetC, META_DOC_IDS_C, TOOL_USE_IDS_C } from './set-c-wide-breadth';
export { seedSetD, seedSetDFrequency } from './set-d-sequential';
