# Favicon 설계 계획

## 목표
Claude Spyglass 웹 대시보드에 브랜드 아이덴티티를 반영한 파비콘을 설계·구현한다.

## 프로젝트 컨텍스트
- **도구명**: Claude Spyglass — Claude Code 실행 과정 가시화 (토큰 누수 탐지)
- **테마**: 다크, 개발자 도구, 모니터링
- **브랜드 색상**: accent `#d97757` (orange), bg `#0f0f0f`, text `#e8e8e8`
- **폰트**: monospace 계열

## 요구사항
1. 브랜드 컨셉 반영: 망원경(spyglass), 감시/관측, 토큰 모니터링
2. SVG 기반 (`<link rel="icon" type="image/svg+xml">`)
3. 다크 배경에서 선명하게 보이는 디자인
4. 브라우저 탭 32×32, 16×16에서 가독성
5. **3회 반복 개선**: 초안 → 검토 → 개선안 → 검토 → 최종안

## 기술 스택
- SVG inline / 파일 기반
- `packages/web/` 위치
- `index.html` `<head>`에 `<link>` 태그 추가

## 성공 기준
- 브라우저 탭에서 spyglass 컨셉이 즉각 인식됨
- 다크·라이트 OS 테마 모두 가독성 확보
- 3번의 전문가 검토를 거친 최종 디자인
