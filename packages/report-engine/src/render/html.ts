import { renderReason } from '@mfd/rule-engine';

import { type LabelKey, labelPair } from '../labels';
import type {
  ChecklistItem,
  DatasheetBlock,
  FindingRow,
  FloorPlanSection,
  ReportModel,
} from '../model';
import { DEFAULT_RENDER_OPTIONS, type RenderOptions } from './types';

/**
 * The HTML renderer — and the editor's preview.
 *
 * One renderer for both, deliberately. A preview built separately from the output is a
 * preview that eventually disagrees with it, and the disagreement surfaces after somebody
 * has sent the PDF. This produces the same sections in the same order from the same model;
 * the PDF differs in typography, not in content.
 *
 * ## Escaping
 *
 * Every value that reaches the page goes through `escape`. The values are not hostile —
 * they are hospital names and room labels an engineer typed — but a room called "A&E" or a
 * note containing "<" would otherwise silently corrupt the markup. This is a document
 * generator, so the failure would be a mangled report rather than an exploit; it is still a
 * failure, and one line prevents it.
 */

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A number with thousands separators, or an em dash when it is unknown. */
function num(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value.toLocaleString('en-US')}${suffix}`;
}

function text(value: string | null): string {
  return value === null || value === '' ? '—' : escape(value);
}

export function renderHtml(model: ReportModel, options: RenderOptions = DEFAULT_RENDER_OPTIONS): string {
  const { primary, secondary } = options;

  /** A stacked bilingual heading: the leading language above, the other beneath. */
  const heading = (key: LabelKey, level: 2 | 3 = 2): string => {
    const pair = labelPair(key);
    return `<h${level}><span class="lead">${escape(pair[primary])}</span><span class="alt">${escape(pair[secondary])}</span></h${level}>`;
  };

  /** An inline bilingual label, one line, for a table header or a field name. */
  const inline = (key: LabelKey): string => {
    const pair = labelPair(key);
    return `${escape(pair[primary])} / ${escape(pair[secondary])}`;
  };

  const field = (key: LabelKey, value: string): string =>
    `<div class="field"><dt>${inline(key)}</dt><dd>${value}</dd></div>`;

  /** A finding or checklist sentence, both languages stacked. */
  const bilingualText = (ko: string, en: string): string => {
    const pair = { ko, en };
    return `<p class="bi"><span class="lead">${escape(pair[primary])}</span><span class="alt">${escape(pair[secondary])}</span></p>`;
  };

  const reason = (code: Parameters<typeof renderReason>[1], params: Parameters<typeof renderReason>[2]): string =>
    bilingualText(renderReason('ko', code, params), renderReason('en', code, params));

  const finding = (row: FindingRow): string => {
    const caveat = row.caveatCode
      ? `<div class="caveat">${reason(row.caveatCode, {})}</div>`
      : '';

    return `<tr data-severity="${row.severity}" data-verification="${row.verification}">
      <td class="sev sev-${row.severity}">${row.severity}</td>
      <td>${row.placementNumbers.map((n) => `<span class="pin">${n}</span>`).join(' ')}<br>${text(row.placementLabels.join(' · '))}</td>
      <td><code>${escape(row.ruleId)}</code><br><span class="lead">${escape(row.ruleName[primary])}</span><br><span class="alt">${escape(row.ruleName[secondary])}</span></td>
      <td><code class="rc">${escape(row.reasonCode)}</code>${reason(row.reasonCode, row.reasonParams)}${caveat}</td>
      <td class="numeric">${num(row.appliedThreshold, ` ${row.unit}`)}<br><span class="alt">${inline(row.thresholdOrigin)}</span></td>
      <td>${text(row.thresholdSource)}</td>
      <td class="numeric">${num(row.measured, ` ${row.unit}`)}</td>
      <td>${inline(row.verification === 'verified' ? 'status_verified' : 'status_draft')}</td>
    </tr>`;
  };

  const datasheetBlock = (block: DatasheetBlock): string => `
    <div class="block">
      <h4>${inline(block.group)}</h4>
      <p class="citation">${block.citation ? escape(block.citation) : inline('no_citation')}</p>
      <dl>${block.fields.map((f) => field(f.label, text(f.value))).join('')}</dl>
    </div>`;

  const checklistItem = (item: ChecklistItem): string => {
    const body = item.text
      ? bilingualText(item.text.ko, item.text.en)
      : item.reasonCode
        ? reason(item.reasonCode, item.reasonParams)
        : '';
    return `<li data-origin="${item.origin}"><span class="action">${inline(item.action)}</span>${body}</li>`;
  };

  /**
   * The drawing, as inline SVG in model millimetres.
   *
   * Vector, not a screenshot of the canvas (AD-2) — the geometry lives outside the renderer,
   * so it can be re-emitted at any size. `viewBox` is the model extent, which makes the
   * millimetre coordinates the drawing's own units and the scale a property of the page
   * rather than of the numbers.
   */
  const drawing = (plan: FloorPlanSection): string => {
    const extent = plan.geometry.extent;
    if (!extent) return `<p class="empty">${inline('no_drawing')}</p>`;

    const pad = 500;
    const width = extent.maxX - extent.minX + pad * 2;
    const height = extent.maxY - extent.minY + pad * 2;
    const points = (line: { points: readonly { x: number; y: number }[] }) =>
      line.points.map((p) => `${p.x},${p.y}`).join(' ');

    return `<svg class="plan" viewBox="${extent.minX - pad} ${extent.minY - pad} ${width} ${height}" role="img">
      ${plan.geometry.rooms.map((r) => `<polygon class="room" points="${points(r)}" />`).join('')}
      ${plan.geometry.obstructions.map((o) => `<polygon class="obstruction" points="${points(o)}" />`).join('')}
      ${plan.geometry.equipment
        .map((e) => {
          const cx = e.points.reduce((sum, p) => sum + p.x, 0) / e.points.length;
          const cy = e.points.reduce((sum, p) => sum + p.y, 0) / e.points.length;
          return `<polygon class="equipment" points="${points(e)}" /><text x="${cx}" y="${cy}" class="pin-label">${escape(e.label)}</text>`;
        })
        .join('')}
    </svg>`;
  };

  const { cover, summary, equipmentSchedule, floorPlans, validation, checklist, datasheets, standards, notice, provenance } = model;

  return `<!-- MFD-E report ${escape(model.reportVersion.toString())} -->
<article class="mfd-report" lang="${primary}" data-verdict="${summary.verdict}">
<style>${STYLE}</style>

<section class="cover" data-testid="report-cover">
  ${heading('report_title')}
  <dl>
    ${field('field_hospital', text(cover.hospital))}
    ${field('field_site', text(cover.site))}
    ${field('field_project', text(cover.projectName))}
    ${field('field_customer', text(cover.customerContact))}
    ${field('field_ts_engineer', text(cover.tsEngineer))}
    ${field('field_date', escape(cover.date))}
    ${field('field_mfd_version', escape(cover.mfdVersion))}
  </dl>
</section>

<section data-testid="report-summary">
  ${heading('section_summary')}
  <div class="verdict verdict-${summary.verdict}" data-testid="report-verdict">
    ${inline(`verdict_${summary.verdict}` as LabelKey)}
  </div>
  <dl class="counts">
    ${field('field_total_equipment', num(summary.totalEquipment))}
    ${field('field_red', num(summary.red))}
    ${field('field_yellow', num(summary.yellow))}
    ${field('field_green', num(summary.green))}
  </dl>
  <ul class="grounds">
    ${summary.grounds.map((g) => `<li>${num(g.count)} — ${inline(g.label)}</li>`).join('')}
  </ul>
</section>

<section data-testid="report-schedule">
  ${heading('section_equipment_schedule')}
  <table>
    <thead><tr>
      <th>${inline('field_equipment_id')}</th>
      <th>${inline('field_manufacturer')}</th>
      <th>${inline('field_model')}</th>
      <th>${inline('field_quantity')}</th>
      <th>${inline('field_manufacturer_dimensions')}</th>
      <th>${inline('field_design_footprint')}</th>
      <th>${inline('field_verification_status')}</th>
    </tr></thead>
    <tbody>
      ${equipmentSchedule.rows
        .map(
          (row) => `<tr>
        <td><code>${escape(row.equipmentId)}</code></td>
        <td>${text(row.manufacturer)}</td>
        <td>${escape(row.model)} <span class="alt">${escape(row.catalogueVersion)}</span></td>
        <td class="numeric">${num(row.quantity)}</td>
        <td class="numeric">${
          row.manufacturerDimensions === null
            ? '—'
            : `${num(row.manufacturerDimensions.width)} × ${num(row.manufacturerDimensions.depth)}${
                row.manufacturerDimensions.height === null
                  ? ''
                  : ` × ${num(row.manufacturerDimensions.height)}`
              } mm`
        }</td>
        <td class="numeric">${num(row.designFootprint.width)} × ${num(row.designFootprint.depth)} mm</td>
        <td>${row.verification
          .map(
            (v) =>
              `<span class="chip chip-${v.status}" title="${v.citation ? escape(v.citation) : escape(labelPair('no_citation')[primary])}">${inline(v.group)}</span>`,
          )
          .join(' ')}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>
  ${
    equipmentSchedule.unknownEquipmentIds.length > 0
      ? `<p class="warning" data-testid="report-unknown-equipment">${equipmentSchedule.unknownEquipmentIds.map(escape).join(', ')}</p>`
      : ''
  }
</section>

${floorPlans
  .map(
    (plan) => `<section data-testid="report-floor-plan" data-level="${escape(plan.levelId)}">
  ${heading('section_floor_plan')}
  <h3>${escape(plan.levelName)}</h3>
  ${plan.calibration === null ? `<p class="warning" data-testid="report-uncalibrated">${inline('not_calibrated')}</p>` : ''}
  ${drawing(plan)}
  <dl>
    ${plan.drawing ? field('field_drawing_file', escape(plan.drawing.sourceFileName)) : field('field_drawing_file', inline('no_drawing'))}
    ${plan.drawing ? field('field_drawing_pixels', `${num(plan.drawing.pixelWidth)} × ${num(plan.drawing.pixelHeight)} px`) : ''}
    ${plan.calibration ? field('field_scale', `${plan.calibration.millimetresPerPixel} mm/px`) : ''}
    ${plan.calibration ? field('field_calibration_method', escape(plan.calibration.method)) : ''}
    ${plan.mapping ? field('field_origin', `${num(plan.mapping.originPixel.x)}, ${num(plan.mapping.originPixel.y)} px`) : ''}
    ${plan.mapping ? field('field_rotation', `${(plan.mapping.rotation / 1000).toFixed(2)}°`) : ''}
  </dl>
  <h4>${inline('table_placements')}</h4>
  <table><thead><tr>
    <th>${inline('field_number')}</th>
    <th>${inline('field_label')}</th>
    <th>${inline('field_model')}</th>
    <th>${inline('field_position')}</th>
    <th>${inline('field_rotation')}</th>
    <th>${inline('field_room')}</th>
  </tr></thead><tbody>
    ${plan.placements
      .map(
        (row) => `<tr>
      <td class="numeric"><span class="pin">${row.number}</span></td>
      <td>${escape(row.label)}</td>
      <td>${escape(row.model)}</td>
      <td class="numeric">${num(row.position.x)}, ${num(row.position.y)} mm</td>
      <td class="numeric">${row.rotationDegrees}°</td>
      <td>${text(row.room)}</td>
    </tr>`,
      )
      .join('')}
  </tbody></table>
  ${
    plan.rooms.length > 0
      ? `<h4>${inline('table_rooms')}</h4><table><thead><tr><th>${inline('field_room')}</th><th>${inline('field_function')}</th><th>${inline('field_area')}</th></tr></thead><tbody>${plan.rooms
          .map(
            (room) =>
              `<tr><td>${escape(room.name)}</td><td>${escape(room.function)}</td><td class="numeric">${room.areaSquareMetres} m²</td></tr>`,
          )
          .join('')}</tbody></table>`
      : ''
  }
  ${
    plan.obstructions.length > 0
      ? `<h4>${inline('table_obstructions')}</h4><table><thead><tr><th>${inline('field_label')}</th><th>${inline('field_obstruction_type')}</th><th>${inline('field_area')}</th></tr></thead><tbody>${plan.obstructions
          .map(
            (o) =>
              `<tr><td>${escape(o.label)}</td><td>${escape(o.obstructionType)}</td><td class="numeric">${o.areaSquareMetres} m²</td></tr>`,
          )
          .join('')}</tbody></table>`
      : ''
  }
</section>`,
  )
  .join('')}

${validation
  .map(
    (section) => `<section data-testid="report-validation" data-level="${escape(section.levelId)}">
  ${heading('section_validation')}
  <h3>${escape(section.levelName)}</h3>
  ${
    section.findings.length === 0
      ? `<p class="empty">${inline('no_findings')}</p>`
      : `<table><thead><tr>
    <th>${inline('field_severity')}</th>
    <th>${inline('field_number')}</th>
    <th>${inline('field_rule_name')}</th>
    <th>${inline('field_finding')}</th>
    <th>${inline('field_applied_threshold')}</th>
    <th>${inline('field_threshold_source')}</th>
    <th>${inline('field_measured')}</th>
    <th>${inline('field_verification_status')}</th>
  </tr></thead><tbody>${section.findings.map(finding).join('')}</tbody></table>`
  }
</section>`,
  )
  .join('')}

<section data-testid="report-checklist">
  ${heading('section_checklist')}
  ${checklist.categories
    .map(
      (category) => `<div class="checklist-category" data-category="${escape(category.id)}">
    <h3><span class="lead">${escape(category.title[primary])}</span><span class="alt">${escape(category.title[secondary])}</span></h3>
    ${
      category.items.length === 0
        ? `<p class="empty">${inline('checklist_empty')}</p>`
        : `<ul class="checklist">${category.items.map(checklistItem).join('')}</ul>`
    }
  </div>`,
    )
    .join('')}
</section>

<section data-testid="report-datasheets">
  ${heading('section_datasheets')}
  ${datasheets
    .map(
      (sheet) => `<div class="datasheet" data-equipment="${escape(sheet.equipmentId)}">
    <h3>${escape(sheet.model)} <span class="alt">${text(sheet.manufacturer)} · ${escape(sheet.catalogueVersion)}</span></h3>
    ${
      sheet.manufacturer_data.length > 0
        ? `<div class="section-verified" data-testid="datasheet-manufacturer">${heading('block_manufacturer_data', 3)}${sheet.manufacturer_data.map(datasheetBlock).join('')}</div>`
        : ''
    }
    <div class="section-planning" data-testid="datasheet-planning">
      ${heading('block_design_footprint', 3)}
      <p class="note">${inline('planning_decision')}</p>
      <dl>${sheet.designFootprint.map((f) => field(f.label, text(f.value))).join('')}</dl>
    </div>
    ${
      sheet.draft_data.length > 0
        ? `<div class="section-draft" data-testid="datasheet-draft">${heading('block_draft_data', 3)}${sheet.draft_data.map(datasheetBlock).join('')}</div>`
        : ''
    }
  </div>`,
    )
    .join('')}
</section>

<section data-testid="report-standards">
  ${heading('section_standards')}
  <p>${inline('field_rule_set')}: <code>${escape(standards.ruleSetId)}</code> v${escape(standards.ruleSetVersion)}</p>
  <table><thead><tr>
    <th>${inline('field_rule_id')}</th>
    <th>${inline('field_rule_name')}</th>
    <th>${inline('field_category')}</th>
    <th>${inline('field_threshold')}</th>
    <th>${inline('field_verification_status')}</th>
    <th>${inline('field_document')}</th>
    <th>${inline('field_finding_count')}</th>
  </tr></thead><tbody>
    ${standards.rules
      .map(
        (rule) => `<tr>
      <td><code>${escape(rule.ruleId)}</code></td>
      <td><span class="lead">${escape(rule.ruleName[primary])}</span><br><span class="alt">${escape(rule.ruleName[secondary])}</span></td>
      <td>${inline(rule.category === 'clearance' ? 'category_clearance' : 'category_collision')}</td>
      <td class="numeric">${num(rule.threshold, ` ${rule.unit}`)}</td>
      <td>${inline(rule.status === 'verified' ? 'status_verified' : 'status_draft')}</td>
      <td>${text([rule.document, rule.revision, rule.section].filter(Boolean).join(' · ') || null)}</td>
      <td class="numeric">${num(rule.findingCount)}</td>
    </tr>`,
      )
      .join('')}
  </tbody></table>
</section>

<section class="notice" data-testid="report-notice">
  ${heading('section_notice')}
  <p class="liability lead">${escape(notice.liability[primary])}</p>
  <p class="liability alt">${escape(notice.liability[secondary])}</p>
  ${notice.caveats
    .map(
      (caveat) =>
        `<p class="caveat"><span class="lead">${escape(caveat[primary])}</span><span class="alt">${escape(caveat[secondary])}</span></p>`,
    )
    .join('')}
</section>

<section class="provenance" data-testid="report-provenance">
  ${heading('section_provenance', 3)}
  <dl>
    ${field('field_report_version', num(provenance.reportVersion))}
    ${field('field_document_version', num(provenance.documentVersion))}
    ${field('field_result_version', num(provenance.evaluationResultVersion))}
    ${field('field_rule_set', `${escape(provenance.ruleSetId)} v${escape(provenance.ruleSetVersion)}`)}
    ${field('field_mfd_version', escape(provenance.mfdVersion))}
    ${field('field_generated_at', escape(provenance.generatedAt))}
  </dl>
</section>
</article>`;
}

/**
 * Print-oriented styling, inline.
 *
 * Inline because the preview renders inside the editor and a report saved as a file has to
 * carry its own appearance — an HTML report that needs a stylesheet alongside it is an HTML
 * report that arrives unreadable.
 */
const STYLE = `
.mfd-report { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; line-height: 1.45; }
.mfd-report h2 { font-size: 15px; margin: 24px 0 8px; border-bottom: 2px solid #111; padding-bottom: 4px; }
.mfd-report h3 { font-size: 13px; margin: 16px 0 6px; }
.mfd-report h4 { font-size: 12px; margin: 12px 0 4px; color: #444; }
.mfd-report .lead { display: block; }
.mfd-report .alt { display: block; color: #666; font-size: 0.85em; font-weight: 400; }
.mfd-report dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 4px 16px; margin: 8px 0; }
.mfd-report .field { display: flex; flex-direction: column; font-size: 11px; }
.mfd-report dt { color: #666; }
.mfd-report dd { margin: 0; font-variant-numeric: tabular-nums; }
.mfd-report table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 8px 0; }
.mfd-report th { text-align: left; background: #f3f4f6; border-bottom: 1px solid #d1d5db; padding: 4px 6px; font-weight: 600; font-size: 10px; }
.mfd-report td { border-bottom: 1px solid #e5e7eb; padding: 4px 6px; vertical-align: top; }
.mfd-report .numeric { text-align: right; font-variant-numeric: tabular-nums; }
.mfd-report code { font-family: ui-monospace, monospace; font-size: 0.9em; }
.mfd-report .sev { font-weight: 700; font-size: 10px; }
.mfd-report .sev-RED { color: #b91c1c; } .mfd-report .sev-YELLOW { color: #b45309; } .mfd-report .sev-GREEN { color: #15803d; }
.mfd-report .verdict { display: inline-block; padding: 6px 12px; font-weight: 700; border: 2px solid; margin: 8px 0; }
.mfd-report .verdict-not_acceptable { color: #b91c1c; border-color: #b91c1c; }
.mfd-report .verdict-review_required { color: #b45309; border-color: #b45309; }
.mfd-report .verdict-acceptable { color: #15803d; border-color: #15803d; }
.mfd-report .verdict-inconclusive { color: #4b5563; border-color: #4b5563; }
.mfd-report .chip { display: inline-block; padding: 1px 4px; margin: 1px; border: 1px solid; font-size: 9px; }
.mfd-report .chip-verified { color: #15803d; border-color: #86efac; background: #f0fdf4; }
.mfd-report .chip-draft { color: #b45309; border-color: #fcd34d; background: #fffbeb; }
.mfd-report .pin { display: inline-block; min-width: 16px; text-align: center; border: 1px solid #111; border-radius: 8px; font-size: 9px; font-weight: 700; }
.mfd-report .warning { color: #b45309; background: #fffbeb; border-left: 3px solid #f59e0b; padding: 6px 8px; font-size: 11px; }
.mfd-report .empty { color: #6b7280; font-size: 11px; font-style: italic; }
.mfd-report .note { color: #6b7280; font-size: 10px; margin: 2px 0; }
.mfd-report .citation { color: #6b7280; font-size: 10px; margin: 0 0 4px; }
.mfd-report .block { margin: 8px 0; padding-left: 8px; border-left: 2px solid #e5e7eb; }
.mfd-report .section-verified { border-left: 3px solid #86efac; padding-left: 8px; margin: 8px 0; }
.mfd-report .section-planning { border-left: 3px solid #93c5fd; padding-left: 8px; margin: 8px 0; }
.mfd-report .section-draft { border-left: 3px solid #fcd34d; padding-left: 8px; margin: 8px 0; }
.mfd-report .bi { margin: 2px 0; font-size: 11px; }
.mfd-report .rc { display: inline-block; background: #f3f4f6; padding: 0 3px; margin-right: 4px; }
.mfd-report .caveat { color: #b45309; font-size: 10px; }
.mfd-report .checklist { list-style: none; padding: 0; }
.mfd-report .checklist li { display: flex; gap: 8px; padding: 3px 0; border-bottom: 1px dotted #e5e7eb; font-size: 11px; }
.mfd-report .checklist li::before { content: '☐'; }
.mfd-report .action { color: #6b7280; font-size: 10px; white-space: nowrap; min-width: 130px; }
.mfd-report .plan { width: 100%; max-height: 420px; background: #fafafa; border: 1px solid #e5e7eb; }
.mfd-report .plan .room { fill: none; stroke: #374151; stroke-width: 40; }
.mfd-report .plan .obstruction { fill: #d1d5db; stroke: #6b7280; stroke-width: 20; }
.mfd-report .plan .equipment { fill: rgba(59,130,246,0.18); stroke: #2563eb; stroke-width: 20; }
.mfd-report .plan .pin-label { font-size: 260px; text-anchor: middle; dominant-baseline: middle; fill: #1e3a8a; font-weight: 700; }
.mfd-report .liability { font-size: 11px; margin: 4px 0; }
.mfd-report .notice { margin-top: 24px; border: 2px solid #111; padding: 10px; }
.mfd-report .provenance { margin-top: 16px; font-size: 10px; color: #6b7280; }
`;
