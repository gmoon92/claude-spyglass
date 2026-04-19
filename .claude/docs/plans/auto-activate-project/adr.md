# auto-activate-project ADR

## ADR-001: 첫 진입 시 프로젝트 자동 선택 전략

### 상태
**결정됨** (2026-04-19)

### 배경

웹 대시보드 첫 진입 시 프로젝트 패널에 목록이 보이지만 세션 패널은 빈 상태다.
사용자가 직접 클릭해야만 세션 목록이 표시되어 신규 사용자의 진입 장벽이 된다.
자동으로 프로젝트를 선택해 세션 목록을 즉시 보여주는 방식을 결정해야 한다.

두 가지 후보 전략을 검토했다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A — 최신 로그 기준 자동 활성화 | `_allSessions`에서 `started_at` 최댓값의 `project_name`을 선택 | 항상 가장 최근 활동 프로젝트를 보여줌 / 서버 API 변경 불필요 / 재진입 시에도 최신 기준 유지 | 재진입 시 이전에 보던 프로젝트와 다를 수 있음 |
| B — localStorage 마지막 선택 복원 | `localStorage`에 저장된 마지막 선택 프로젝트를 우선 복원 | 사용자 의도 연속성 유지 / 작업 맥락 보존 | 마지막 선택 프로젝트에 최신 활동이 없을 수 있음 / 첫 방문 시 폴백 필요 |

### 결정

**옵션 A + B 조합**: `localStorage` 복원을 우선하되, 저장값이 없거나 해당 프로젝트가 더 이상 존재하지 않으면 최신 세션 기준 프로젝트로 폴백한다.

우선순위:
1. `localStorage`에 저장된 마지막 선택 프로젝트 (해당 프로젝트가 현재 `_allProjects` 목록에 존재하는 경우)
2. `_allSessions` 중 `started_at` 최댓값의 `project_name`
3. `_allProjects[0]` (세션 데이터도 없는 경우 마지막 폴백)

### 이유

1. **사용자 의도 연속성**: 재방문 사용자는 이전에 보던 프로젝트를 다시 보는 것이 자연스럽다. `localStorage`를 우선하면 작업 맥락이 유지된다.
2. **신규 사용자 경험**: 첫 방문 시 `localStorage`가 없으므로 최신 활동 프로젝트로 자동 진입하여 즉시 의미 있는 데이터를 볼 수 있다.
3. **서버 API 무변경**: `_allSessions`의 `started_at` 필드를 활용하면 별도 API 엔드포인트나 DB 변경 없이 구현 가능하다.
4. **폴백 안전성**: 프로젝트 삭제나 이름 변경 시에도 폴백 체인이 항상 유효한 프로젝트를 선택한다.

---

## ADR-002: 자동 선택 실행 시점

### 상태
**결정됨** (2026-04-19)

### 배경

`fetchDashboard()`와 `fetchAllSessions()`는 병렬로 실행된다(`init()`에서 동시 호출).
자동 선택은 프로젝트 목록(`_allProjects`)과 세션 목록(`_allSessions`) 양쪽이 모두 준비된 후 실행해야 한다.
세션 패널은 `_selectedProject`가 세팅된 상태에서 `renderBrowserSessions()`가 호출되어야 정상 표시되기 때문이다.

### 고려한 옵션

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A — `fetchAllSessions` 완료 콜백 | `fetchAllSessions()` resolve 후 `autoActivateProject()` 호출 | 타이밍 명확 / Promise 체인 활용 | `_allProjects`가 아직 없을 경우 대비 필요 |
| B — `Promise.all([fetchDashboard, fetchAllSessions])` | 두 요청 모두 완료 후 자동 선택 | 가장 안전한 타이밍 보장 | 둘 중 하나가 느리면 전체 지연 |
| C — `fetchAllSessions` 완료 + `_allProjects` 존재 확인 | `fetchAllSessions` 완료 시점에 `_allProjects` 존재 여부 확인 후 진행 | 빠른 응답, 안전한 폴백 | 구현이 약간 복잡 |

### 결정

**옵션 A**: `fetchAllSessions()` Promise 완료 후 `autoActivateProject()` 호출.
`fetchDashboard()`가 먼저 완료되는 경우가 대부분이므로, `fetchAllSessions()` 완료 시점에는 `_allProjects`가 이미 채워져 있다.
`_allProjects`가 비어 있는 엣지 케이스는 `_allSessions`에서 `project_name` 추출로 대응한다.

### 이유

1. **현실적 타이밍**: `fetchDashboard()`는 집계 쿼리이지만 `fetchAllSessions()`는 최대 500건 조회로 비슷한 응답 시간을 가진다. 대부분의 경우 `fetchAllSessions()` 완료 시점에 `_allProjects`가 준비되어 있다.
2. **단순성**: `Promise.all` 패턴보다 단일 완료 콜백이 기존 코드 구조(독립적 fetch 함수들)를 덜 변경한다.
3. **이미 수행 중인 렌더링 재사용**: `selectProject()`는 이미 `fetchSessionsByProject()`를 호출하고 `renderBrowserProjects()`를 갱신하므로 별도 렌더링 로직이 불필요하다.

---

## ADR-003: localStorage 키 및 저장 정책

### 상태
**결정됨** (2026-04-19)

### 배경

`localStorage`에 마지막 선택 프로젝트를 저장할 때 키 명명과 저장 시점을 결정해야 한다.

### 결정

- **키**: `spyglass:lastProject`
- **저장 시점**: `selectProject(name)` 함수 내부에서 저장 (자동 선택 및 수동 클릭 모두 동일 경로)
- **삭제 정책**: 별도 만료 없음. 해당 프로젝트가 `_allProjects`에 없으면 무시(자동 폴백)

### 이유

1. **단일 진입점**: `selectProject()`를 통한 모든 선택이 동일하게 저장되므로 저장 누락이 없다.
2. **네임스페이스 일관성**: `spyglass:` 접두사로 다른 앱과의 충돌을 방지한다.
3. **단순 만료 정책**: 프로젝트 존재 여부로 유효성을 검증하므로 TTL 관리가 불필요하다.
