/**
 * @mfd/report-engine — the MFD-E engineering report engine.
 *
 * Pure TypeScript. No React, no Konva, no NestJS, no DOM, no filesystem: the PDF renderer
 * takes font bytes as an argument rather than reading a file, which is what keeps the same
 * code runnable in a browser and on a server (AD-3).
 *
 * ## Not a PDF exporter
 *
 * Owner decision, Sprint 5: *"Sprint 5 is NOT a PDF export sprint. Sprint 5 is the
 * Engineering Report Engine"*, and it must later render PDF, DOCX, HTML and JSON **without
 * changing business logic**.
 *
 * That requirement is met by one boundary:
 *
 * ```
 * document + catalogue + rule set ──► ReportModel ──► renderer
 *           business logic              data          typography
 * ```
 *
 * Everything the report *claims* — the verdict, which findings are provisional, which
 * figures are cited — is decided building the model. A renderer chooses fonts and page
 * breaks. So a new format is a new file under ./render/, and the proof that the boundary
 * holds is that the JSON renderer is three lines.
 *
 * ## Bilingual
 *
 * Every section title, field label, finding, warning and recommendation exists in Korean
 * and English:
 *
 * | | Mechanism |
 * | --- | --- |
 * | Labels and titles | `LabelKey` into ./labels.ts — one reviewable file |
 * | Findings | `ReasonCode` from the rule engine, composed per language |
 * | Rule names | The rule file, because a rule's name is part of the rule |
 * | Names, citations, numbers | Printed once, as typed |
 */

export * from './model';
export * from './labels';
export * from './groups';
export * from './notice';
export * from './conclusion';
export * from './equipment';
export * from './floorPlan';
export * from './validation';
export * from './checklist';
export * from './checklistTemplate';
export * from './standards';
export * from './build';
export * from './fingerprint';

export * from './render/types';
export * from './render/paper';
export * from './render/json';
export * from './render/html';

// The PDF renderer is **not** re-exported here. It is `@mfd/report-engine/pdf`, because
// pdf-lib and fontkit are ~1.2 MB and re-exporting them from the index put them in every
// consumer's initial bundle. See ../pdf.ts.
