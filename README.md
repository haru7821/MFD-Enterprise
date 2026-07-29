# MFD-Enterprise

MFD(Manufacturing Facility Design) Enterprise — 제조 설비 레이아웃 설계/검증 플랫폼.

## 저장소 구조

```
MFD-Enterprise
├── docs/         기획·아키텍처·엔진·DB·AI·로드맵 문서
├── apps/         실행 애플리케이션 (web, api, ai-service)
├── packages/     공용 패키지 (cad-engine, object-library, rule-engine, report-engine)
├── database/     스키마·마이그레이션·시드 데이터
├── assets/       아이콘·심볼·3D 모델 등 정적 리소스
├── standards/    설계 표준·규정 원문 및 정리본
└── tests/        통합·E2E 테스트
```

## 문서

| 문서 | 설명 |
| --- | --- |
| [docs/00_VISION.md](docs/00_VISION.md) | 제품 비전 |
| [docs/01_MASTER_SPEC.md](docs/01_MASTER_SPEC.md) | 마스터 명세 |
| [docs/02_PRODUCT_REQUIREMENTS.md](docs/02_PRODUCT_REQUIREMENTS.md) | 제품 요구사항 (PRD) |
| [docs/03_SYSTEM_ARCHITECTURE.md](docs/03_SYSTEM_ARCHITECTURE.md) | 시스템 아키텍처 |
| [docs/04_TECH_STACK.md](docs/04_TECH_STACK.md) | 기술 스택 |
| [docs/05_UI_UX_SPEC.md](docs/05_UI_UX_SPEC.md) | UI/UX 명세 |
| [docs/engines/](docs/engines/) | 엔진별 상세 설계 |
| [docs/database/](docs/database/) | 데이터 스키마 |
| [docs/ai/](docs/ai/) | AI 에이전트·프롬프트·지식베이스 |
| [docs/roadmap/](docs/roadmap/) | MVP 및 개발 로드맵 |

작업 규칙은 [CLAUDE.md](CLAUDE.md)를 참고하세요.
