import type { Bilingual, Language } from '@mfd/rule-engine';

/**
 * Every word the report prints that is **ours**, in Korean and English.
 *
 * Owner decision: each section title and field label contains both languages. This is the
 * one file that wording lives in, and there are three reasons it is a catalogue of keys
 * rather than pairs of strings inlined into the model:
 *
 * 1. **A model fixture asserts data, not wording.** If every schedule row carried both
 *    strings, editing a Korean label would redden thirty tests that are about millimetres.
 * 2. **One file to review.** A Korean-speaking reviewer reads this, not the generator.
 * 3. **A missing translation cannot ship.** `satisfies Record<string, Bilingual>` makes a
 *    half-translated entry a compile error, and `labels.test.ts` locks the key set.
 *
 * `LABELS` is **not** in `standards/`. AD-4 makes that directory the source of record for
 * engineering rules; a column heading is not one, and putting wording there would blur what
 * the directory means. Rule *names* are the opposite case and do live there — a rule's name
 * is part of the rule.
 *
 * ## What is deliberately absent
 *
 * Finding sentences. Those come from the rule engine's reason codes, composed per language
 * from `reasonCode` + `reasonParams`. A report engine holding its own copy of finding prose
 * is exactly the drift the reason-code design exists to prevent.
 */

export const LABELS = {
  // ── Document and sections ───────────────────────────────────────────────────
  report_title: { ko: '투석실 설치 검토 보고서', en: 'Dialysis Installation Review Report' },
  section_cover: { ko: '표지', en: 'Cover' },
  section_summary: { ko: '종합 요약', en: 'Executive Summary' },
  section_equipment_schedule: { ko: '장비 목록', en: 'Equipment Schedule' },
  section_floor_plan: { ko: '평면도', en: 'Floor Plan' },
  section_validation: { ko: '기술 검토 결과', en: 'Validation Report' },
  section_checklist: { ko: '설치 점검표', en: 'Installation Checklist' },
  section_datasheets: { ko: '장비 데이터시트', en: 'Equipment Datasheets' },
  section_standards: { ko: '적용 기준', en: 'Applied Standards' },
  section_notice: { ko: '책임 범위', en: 'Liability Statement' },
  section_provenance: { ko: '문서 출처', en: 'Document Provenance' },

  // ── Cover ───────────────────────────────────────────────────────────────────
  field_hospital: { ko: '병원', en: 'Hospital' },
  field_site: { ko: '현장', en: 'Site' },
  field_project: { ko: '프로젝트', en: 'Project' },
  field_customer: { ko: '고객 담당자', en: 'Customer Contact' },
  field_ts_engineer: { ko: 'TS 엔지니어', en: 'TS Engineer' },
  field_date: { ko: '작성일', en: 'Date' },
  field_mfd_version: { ko: 'MFD 버전', en: 'MFD Version' },

  // ── Executive summary ───────────────────────────────────────────────────────
  field_total_equipment: { ko: '총 장비 수', en: 'Total Equipment' },
  field_green: { ko: '적합', en: 'Green' },
  field_yellow: { ko: '검토 필요', en: 'Yellow' },
  field_red: { ko: '부적합', en: 'Red' },
  field_verdict: { ko: '종합 판정', en: 'Verdict' },

  verdict_acceptable: { ko: '적합', en: 'Acceptable' },
  verdict_review_required: { ko: '검토 필요', en: 'Review Required' },
  verdict_not_acceptable: { ko: '부적합', en: 'Not Acceptable' },
  verdict_inconclusive: { ko: '판정 불가', en: 'Inconclusive' },

  ground_red_findings: { ko: '설치를 막는 부적합 항목', en: 'findings preventing installation' },
  ground_yellow_findings: { ko: '검토가 필요한 항목', en: 'findings requiring review' },
  ground_missing_threshold: { ko: '요구치가 없어 판정하지 못한 항목', en: 'findings with no requirement to compare against' },
  ground_uncalibrated_levels: { ko: '축척이 설정되지 않은 층', en: 'levels with no calibrated drawing' },
  ground_draft_groups: { ko: '제조사 근거가 없는 자료 항목', en: 'equipment field groups with no manual reference' },
  ground_no_equipment: { ko: '배치된 장비 없음', en: 'no equipment placed' },

  field_missing_references: { ko: '근거 문서 미확보 항목', en: 'Missing References' },
  field_missing_citations: { ko: '제조사 근거 미확보 항목', en: 'Missing Manufacturer Citations' },
  field_draft_rules: { ko: '미검증 규정 수', en: 'Draft Rule Count' },
  evidence_heading: { ko: '확보되지 않은 근거', en: 'Outstanding Evidence' },

  // ── Equipment ───────────────────────────────────────────────────────────────
  field_equipment_id: { ko: '장비 ID', en: 'Equipment ID' },
  field_manufacturer: { ko: '제조사', en: 'Manufacturer' },
  field_model: { ko: '모델', en: 'Model' },
  field_catalogue_version: { ko: '카탈로그 버전', en: 'Catalogue Version' },
  field_quantity: { ko: '수량', en: 'Quantity' },
  field_manufacturer_dimensions: { ko: '제조사 치수', en: 'Manufacturer Dimensions' },
  field_design_footprint: { ko: '설계 점유 면적', en: 'Design Footprint' },
  field_footprint_basis: { ko: '설정 근거', en: 'Footprint Basis' },
  field_verification_status: { ko: '검증 상태', en: 'Verification Status' },
  field_weight: { ko: '중량', en: 'Weight' },
  field_height: { ko: '높이', en: 'Height' },

  block_manufacturer_data: { ko: '제조사 자료 (검증됨)', en: 'Manufacturer Data (Verified)' },
  block_design_footprint: { ko: '설계 점유 면적 (설계 기준)', en: 'Design Footprint (Planning Decision)' },
  block_draft_data: { ko: '미검증 자료', en: 'Draft Data' },

  group_manufacturerDimensions: { ko: '제조사 치수', en: 'Manufacturer Dimensions' },
  group_serviceClearance: { ko: '정비 공간', en: 'Service Clearance' },
  group_power: { ko: '전원 규격', en: 'Electrical Specification' },
  group_roWater: { ko: 'RO 수 규격', en: 'RO Water Specification' },
  group_drain: { ko: '배수 규격', en: 'Drain Specification' },
  group_environmental: { ko: '환경 조건', en: 'Environmental Specification' },

  status_verified: { ko: '검증됨', en: 'Verified' },
  status_draft: { ko: '미검증', en: 'Draft' },

  not_supplied: { ko: '미제공', en: 'Not supplied' },
  no_citation: { ko: '제조사 근거 없음', en: 'No manual reference' },
  planning_decision: { ko: '설계 결정 사항 — 제조사 근거 없음', en: 'Planning decision — no manufacturer citation' },

  // ── Floor plan ──────────────────────────────────────────────────────────────
  field_level: { ko: '층', en: 'Level' },
  field_elevation: { ko: '기준 높이', en: 'Elevation' },
  field_drawing_file: { ko: '도면 파일', en: 'Drawing File' },
  field_drawing_format: { ko: '형식', en: 'Format' },
  field_drawing_page: { ko: '페이지', en: 'Page' },
  field_drawing_pixels: { ko: '이미지 크기', en: 'Image Size' },
  field_imported_at: { ko: '가져온 시각', en: 'Imported At' },
  field_calibration_method: { ko: '축척 설정 방법', en: 'Calibration Method' },
  field_scale: { ko: '축척', en: 'Scale' },
  field_known_distance: { ko: '입력 실거리', en: 'Known Distance' },
  field_stated_ratio: { ko: '도면 표기 축척', en: 'Stated Ratio' },
  field_dpi: { ko: '해상도', en: 'Resolution' },
  field_calibrated_at: { ko: '축척 설정 시각', en: 'Calibrated At' },
  field_origin: { ko: '원점 (모델 0, 0)', en: 'Origin (model 0, 0)' },
  field_rotation: { ko: '회전', en: 'Rotation' },
  field_mapped_at: { ko: '좌표 설정 시각', en: 'Mapped At' },
  field_number: { ko: '번호', en: 'No.' },
  field_label: { ko: '명칭', en: 'Label' },
  field_position: { ko: '좌표', en: 'Position' },
  field_room: { ko: '실', en: 'Room' },
  field_area: { ko: '면적', en: 'Area' },
  field_function: { ko: '용도', en: 'Function' },
  field_obstruction_type: { ko: '장애물 종류', en: 'Obstruction Type' },
  field_mirrored: { ko: '좌우 반전', en: 'Mirrored' },

  table_rooms: { ko: '실 목록', en: 'Rooms' },
  table_obstructions: { ko: '장애물 목록', en: 'Obstructions' },
  table_placements: { ko: '장비 배치 목록', en: 'Placement Table' },

  no_drawing: { ko: '가져온 도면 없음', en: 'No drawing imported' },
  mode_vector: { ko: '벡터 도면만', en: 'Vector only' },
  mode_vector_raster: { ko: '벡터 + 원본 스캔', en: 'Vector over the scan' },
  mode_raster: { ko: '원본 스캔만 (디버그)', en: 'Scan only (debug)' },
  mode_raster_warning: {
    ko: '디버그 모드 — 원본 스캔만 표시되며 검토된 배치는 그려지지 않았습니다. 고객 제출용이 아닙니다.',
    en: 'Debug mode — the scan is shown without the assessed layout drawn over it. Not for issue to a customer.',
  },
  field_render_mode: { ko: '도면 표시 방식', en: 'Drawing mode' },
  not_calibrated: { ko: '축척 미설정 — 이 층의 치수는 검증되지 않았습니다', en: 'Not calibrated — no measurement from this level is verified' },

  // ── Validation ──────────────────────────────────────────────────────────────
  field_severity: { ko: '등급', en: 'Severity' },
  field_rule_id: { ko: '규정 ID', en: 'Rule ID' },
  field_rule_name: { ko: '규정명', en: 'Rule Name' },
  field_finding: { ko: '검토 내용', en: 'Finding' },
  field_applied_threshold: { ko: '적용 요구치', en: 'Applied Threshold' },
  field_threshold_source: { ko: '요구치 근거', en: 'Threshold Source' },
  field_measured: { ko: '실측값', en: 'Measured' },
  field_reason_code: { ko: '코드', en: 'Code' },

  origin_rule: { ko: '규정', en: 'Rule' },
  origin_equipment: { ko: '장비 자료', en: 'Equipment record' },
  origin_none: { ko: '없음', en: 'None' },

  no_threshold_source: { ko: '근거 문서 없음', en: 'No source document' },
  no_findings: { ko: '검토 결과 없음 — 배치된 장비가 없습니다', en: 'No findings — no equipment placed' },

  // ── Checklist ───────────────────────────────────────────────────────────────
  action_resolve: { ko: '해결 필요', en: 'Resolve' },
  action_confirm_on_site: { ko: '현장 확인 필요', en: 'Confirm on site' },
  action_obtain_manual: { ko: '제조사 자료 확보 필요', en: 'Obtain manufacturer documentation' },
  action_calibrate: { ko: '도면 축척 설정 필요', en: 'Calibrate the drawing' },
  action_check: { ko: '점검', en: 'Check' },

  checklist_empty: { ko: '이 항목에서 도출된 조치 사항 없음', en: 'Nothing outstanding in this category' },

  // ── Standards ───────────────────────────────────────────────────────────────
  field_category: { ko: '분류', en: 'Category' },
  field_threshold: { ko: '요구치', en: 'Threshold' },
  field_document: { ko: '문서', en: 'Document' },
  field_revision: { ko: '개정', en: 'Revision' },
  field_section: { ko: '항목', en: 'Section' },
  field_source_type: { ko: '자료 종류', en: 'Source Type' },
  field_last_updated: { ko: '최종 갱신', en: 'Last Updated' },
  field_finding_count: { ko: '도출 결과 수', en: 'Findings' },
  field_rule_set: { ko: '규정 세트', en: 'Rule Set' },

  category_clearance: { ko: '정비 공간', en: 'Clearance' },
  category_collision: { ko: '간섭', en: 'Collision' },

  // ── Provenance ──────────────────────────────────────────────────────────────
  field_report_version: { ko: '보고서 형식 버전', en: 'Report Format Version' },
  field_document_version: { ko: '프로젝트 파일 버전', en: 'Project File Version' },
  field_result_version: { ko: '판정 형식 버전', en: 'Evaluation Contract Version' },
  field_generated_at: { ko: '생성 시각', en: 'Generated At' },
  field_page: { ko: '페이지', en: 'Page' },
} as const satisfies Record<string, Bilingual>;

export type LabelKey = keyof typeof LABELS;

export const LABEL_KEYS = Object.keys(LABELS) as readonly LabelKey[];

/** One label in one language. */
export function label(language: Language, key: LabelKey): string {
  return LABELS[key][language];
}

/**
 * A label in both languages, on one line.
 *
 * For table headers and inline fields, where two lines would double the height of every
 * row on the page. Section titles stack instead — that is a renderer's decision, and it is
 * why this returns a string rather than being the only way to print a label.
 */
export function bilingualLabel(key: LabelKey, separator = ' / '): string {
  const { ko, en } = LABELS[key];
  return `${ko}${separator}${en}`;
}

/** The pair itself, for a renderer that wants to stack or style the two differently. */
export function labelPair(key: LabelKey): Bilingual {
  return LABELS[key];
}
