# tui-settings — Settings Tab (T5)

> TUI 네 번째 탭. 4개 필드 편집(warning/critical/apiUrl/pollInterval) + 저장 피드백.
> 5라운드 누적 인벤토리.

---

## R1 — 1차 작성

### 진입 조건
- activeTab === 'settings'
- isActive prop useInput 가드

### 데이터 소스
- useConfig: { config, loadError, saveError, save }

### FIELDS 4개
- warning: 'Warning Threshold (tokens)' — 이 토큰 수 초과 시 경고
- critical: 'Critical Threshold (tokens)' — 이 토큰 수 초과 시 위험
- apiUrl: 'API Server URL' — spyglass 서버 주소
- pollInterval: 'Poll Interval (ms)' — 자동 갱신 주기

### 화면 구조
- 헤더 "Settings" (cyan bold)
- loadError (yellow): "⚠ ${loadError}"
- 4개 필드 (각 marginBottom=1):
  - prefix `> ` 또는 `  ` (커서 색)
  - 라벨 (커서 cyan bold / 그 외 white)
  - 값 (편집 중: yellow + █ 커서, 그 외: green)
  - hint (편집 중이거나 커서 시: gray dim)
- 저장 상태:
  - saveError 있으면: "✗ 저장 실패: ${saveError}" (red)
  - 저장 성공 후 1초간: "✓ 저장됨" (green)
- 푸터: "↑↓ Navigate | Enter Edit/Save | ESC Cancel" (gray)

### 키보드 (편집 모드 분기)

#### 탐색 모드 (editValue === null)
- ↑: cursor -= 1 (Math.max 0)
- ↓: cursor += 1 (Math.min 3)
- Enter: editValue = String(config[field.key]) → 편집 모드 진입

#### 편집 모드 (editValue !== null)
- Enter: parseInt (number 필드) 또는 string → save(next) → editValue null + setSaved(true)
- ESC: editValue null (취소)
- Backspace/Delete: editValue 마지막 글자 제거
- 일반 input: editValue 누적

### 저장 흐름
- save(config) 호출 → useConfig가 파일/스토리지 저장
- saveError 있으면 표시
- saved true → 1초 후 false로 자동 클리어

### number vs string 필드
- numFields: warning, critical, pollInterval
- 그 외: string (apiUrl)
- parseInt → NaN이면 editValue null (취소 효과)

---

## R2 — 검토

1. **편집 중 표시 시각**: yellow + 커서 █. 시각 명확.
2. **green vs cyan 라벨 색**: 비활성/활성 차이.
3. **hint 표시 조건**: isCursor && (편집 중이거나 탐색 중). 정확히는 isCursor만 — 코드 확인 결과 그대로.
4. **Backspace 편집 시**: 마지막 글자 제거 ✅.
5. **NaN 처리**: 숫자 필드에 비숫자 입력 → setEditValue(null) → 취소 효과. 사용자에게 "잘못된 값" 알림 부재.
6. **save Error 종류**: 파일 권한, 네트워크 등 — saveError 텍스트로만 표시.
7. **loadError 종류**: 파일 못 찾음, JSON 파싱 실패 등.
8. **디폴트 값**: useConfig가 default 제공.
9. **Tab 전환 후 editValue 보존**: state 유지 — 다시 진입 시 편집 모드 그대로.
10. **field.key undefined**: FIELDS array index out of bound 가드 부재.
11. **input 입력 길이 제한 부재**: 매우 긴 텍스트 가능.

---

## R3 — R2 반영 + 추가

### 보강

- **hint 표시 조건 (정확)**: `{isCursor && (...)}` — 커서일 때만 hint 표시. 편집 중이든 아니든 isCursor면 표시.
- **NaN 알림 부재 — 잠재 UX 버그**: 사용자가 "abc" 입력 → Enter → 무동작 (취소). 알림 없음.
- **save 실패 메시지 표시 위치**: 푸터 위 marginTop=1 영역.
- **저장 성공 1초 자동 클리어**: useEffect setTimeout(1000) clear.
- **input 길이 제한 부재**: 매우 긴 URL/숫자 입력 가능.
- **field.key 안전성**: FIELDS는 4개 고정, cursor 0~3 — out of bound 불가능.

### 추가 인터랙션

- **저장 시 저장 위치**: useConfig 내부 — 파일/localStorage/API 중 어디?
- **변경 후 다른 탭에 자동 반영**: useConfig 변경이 다른 컴포넌트에 자동 전파되는지 확인 필요.
- **default 값 표시**: 사용자가 default로 되돌리는 단축키 부재.

---

## R4 — 검토 (미세·키보드·에러·상태 전이)

1. **편집 모드 Enter 충돌**: useKeyboard의 Enter도 처리될 수 있는지 확인 필요. SettingsTab의 useInput이 우선.
2. **isActive 가드 ✅**.
3. **NaN 입력 → 무동작**: 사용자에게 단서 부재 — 시각 알림 추가 후보.
4. **input 길이 제한 부재**.
5. **default 복원 부재**: ?표시/단축키.
6. **취소 시 변경 내용 손실**: 명시 경고 부재.
7. **저장 실패 후 재시도**: 단순 다시 Enter — 같은 값으로 재시도. 명시적 retry UI 부재.
8. **field 추가 시 maxIndex hardcoded**: FIELDS.length 사용 → 동적 ✅.
9. **hint 텍스트 한국어**: "이 토큰 수 초과 시 경고" — 라벨은 영문, hint는 한글. 일관성 약함.
10. **편집 중 다른 탭 전환**: useKeyboard F1~F4가 useInput 우선순위에 따라 처리. 편집 중에 F1 누르면 편집 취소 후 탭 전환? 아니면 무시? — 코드 확인 필요.
11. **숫자 필드 0 입력**: pollInterval=0 가능 — 폴링 무한 호출 위험.
12. **apiUrl 검증 부재**: URL 형식 확인 안 함.

---

## R5 — R4 반영 + 최종 추가

### 추가된 미세·접근성·상태 전이

- **NaN 입력 시 알림 부재**
- **input 길이 제한 부재**
- **default 복원 단축키 부재**
- **편집 취소 시 경고 부재**
- **저장 실패 retry UI 부재**
- **hint 영문/한글 혼재**
- **편집 중 F1~F4 동작 미확인**: useKeyboard 우선순위
- **pollInterval=0 위험 — 검증 부재**
- **apiUrl 형식 검증 부재**
- **save 비동기 처리**: useConfig save 동기/비동기? saved=true 즉시 설정 — race 가능
- **편집 모드 시각 단서 ✅**: yellow + █ 커서 — 좋음
- **field 4개 hardcoded**: 새 설정 추가 시 FIELDS array 수정 필요
- **저장 위치 명시 부재**: 사용자가 "어디에 저장되었는지" 모름
- **변경 후 즉시 반영 vs 재시작 필요**: apiUrl 변경 시 즉시 반영되는지 불명
- **Tab 보존 state — 의도? 버그?**: 다른 탭 갔다 돌아왔을 때 편집 모드가 그대로

### 키보드 단축키 (구현 vs 부재)

| 의도 | 현재 |
|------|------|
| ↑↓ 이동 | ✅ |
| Enter 편집/저장 | ✅ |
| ESC 취소 | ✅ |
| Backspace 글자 삭제 | ✅ |
| 일반 input 누적 | ✅ |
| Default 복원 | ❌ |
| Cmd/Ctrl+S 저장 | ❌ |
| Cmd/Ctrl+Z 되돌리기 | ❌ |

---

## 최종 기능 개수 (T5)

- 진입/데이터: 2개
- FIELDS 4개: 4개
- 화면 구조 (헤더/loadError/필드/저장 상태/푸터): 5개
- 시각 상태 (탐색/편집/저장 성공/저장 실패): 4개
- 키보드 5종: 5개
- 저장 흐름 (save/saved/auto clear): 3개
- number vs string 분기: 1개
- NaN 가드 (취소 효과): 1개

총 **약 25개 기능**.

## 발견된 누락·모호 (Phase 2 입력)

1. NaN 입력 시 알림 부재 (잠재 UX 버그)
2. input 길이 제한 부재
3. Default 복원 단축키 부재
4. 편집 취소 시 변경 손실 경고 부재
5. 저장 실패 retry UI 부재
6. hint 영문/한글 혼재
7. 편집 중 F1~F4 우선순위 미확인
8. pollInterval=0 위험 — 검증 부재
9. apiUrl 형식 검증 부재
10. save 비동기 처리 race 가능
11. 저장 위치 명시 부재 (사용자 컨텍스트 부족)
12. 변경 즉시 반영 vs 재시작 필요 미명시
13. Tab 전환 후 편집 모드 보존 (의도/버그)
14. Cmd/Ctrl+S/Z 표준 단축키 부재
15. FIELDS hardcoded — 새 설정 추가 시 array 수정
