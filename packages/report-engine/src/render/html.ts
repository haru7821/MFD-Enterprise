import { renderReason } from '@mfd/rule-engine';

import { type LabelKey, labelPair } from '../labels';
import type { PlanService } from '@mfd/ai-contract';

import type {
  BomRow,
  ChecklistItem,
  DatasheetBlock,
  FindingRow,
  FloorPlanSection,
  ReportModel,
  SourcedFigure,
  SourcedRangeFigure,
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

/**
 * A millimetre dimension, **without** thousands separators.
 *
 * 1305, not 1,305. Engineering drawings and the equipment palette both write it that way, and
 * the datasheet section already did — the schedule using `num()` meant one document printing
 * the same figure two ways, which a browser spec caught.
 */
function mm(value: number | null): string {
  return value === null ? '—' : String(value);
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
   * A planner figure.
   *
   * An unknown prints the word, in both languages, rather than a dash or a zero — the owner's
   * *"unknown values remain Unknown"* only survives if it reads as a statement. A known figure
   * prints its status beside it so a calculated hour and a manufacturer's figure never look alike,
   * and a calculated one carries the inputs it was computed from so the sum can be checked.
   */
  const figure = (value: SourcedFigure): string => {
    if (value.value === null) {
      return `<span class="unknown" data-status="unknown">${inline('status_unknown')}<span class="src">${escape(value.sourceRef)}</span></span>`;
    }
    const status =
      value.status === 'calculated'
        ? inline('status_calculated')
        : value.status === 'verified'
          ? inline('status_verified')
          : value.status === 'draft'
            ? inline('status_draft')
            : inline('status_planning');
    /*
     * Owner decision B-7's four disclosures, printed beside the figure: the formula, every input
     * with its value, the rate id and the citation. A reader can check `2 + (1.5 × 12) = 20` on the
     * page rather than take it — which is the difference between a figure that can be argued with
     * and one that has to be trusted.
     */
    const workings = value.calculation
      ? `<span class="src">${escape(value.calculation.formula)} = ${value.calculation.inputs
          .map((entry) => `${escape(entry.name)} ${entry.value}`)
          .join(', ')}${
          value.calculation.rateId
            ? ` · ${escape(value.calculation.rateId)} · ${escape(value.calculation.citation ?? '')}`
            : ''
        }</span>`
      : '';
    return `<span data-status="${value.status}">${escape(String(value.value))} ${escape(value.unit)} <span class="alt">${status}</span>${workings}</span>`;
  };

  /** A crew size — B-7's `minimumPersons, recommendedPersons`, or the word Unknown. */
  const range = (value: SourcedRangeFigure): string => {
    if (value.minimum === null || value.recommended === null) {
      return `<span class="unknown" data-status="unknown">${inline('status_unknown')}<span class="src">${escape(value.sourceRef)}</span></span>`;
    }
    return `<span data-status="${value.status}">${value.minimum}–${value.recommended} ${escape(value.unit)}${
      value.citation ? `<span class="src">${escape(value.sourceRef)} · ${escape(value.citation)}</span>` : ''
    }</span>`;
  };

  const bomRow = (row: BomRow): string =>
    `<tr><td><span class="lead">${escape(row.title[primary])}</span><span class="alt">${escape(row.title[secondary])}</span></td>
      <td><code>${escape(row.id)}</code></td>
      <td class="numeric">${figure(row.quantity)}</td></tr>`;

  const SERVICE_LABEL = {
    power: 'service_power',
    ro_water: 'service_ro_water',
    drain: 'service_drain',
  } as const satisfies Record<PlanService, LabelKey>;

  /**
   * The drawing, as inline SVG in model millimetres.
   *
   * Vector, not a screenshot of the canvas (AD-2) — the geometry lives outside the renderer,
   * so it can be re-emitted at any size. `viewBox` is the model extent, which makes the
   * millimetre coordinates the drawing's own units and the scale a property of the page
   * rather than of the numbers.
   */
  const drawing = (plan: FloorPlanSection): string => {
    const showRaster = model.renderMode !== 'vector' && plan.raster !== null;
    const showVector = model.renderMode !== 'raster';

    const extent = plan.geometry.extent;
    // Raster-only with a plan is still a page worth drawing; vector-only with no geometry is
    // not, and neither is either mode with nothing at all.
    if (!extent && !showRaster) return `<p class="empty">${inline('no_drawing')}</p>`;

    const pad = 500;
    const box = extent ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const raster = plan.raster;
    // With no traced geometry the raster defines the viewBox, in the millimetres its own
    // calibration gives it — so a raster-only page is still measured rather than merely shown.
    const frame =
      extent ?? (raster ? { minX: raster.x, minY: raster.y, maxX: raster.x + raster.width, maxY: raster.y + raster.height } : box);

    const width = frame.maxX - frame.minX + pad * 2;
    const height = frame.maxY - frame.minY + pad * 2;
    const points = (line: { points: readonly { x: number; y: number }[] }) =>
      line.points.map((p) => `${p.x},${p.y}`).join(' ');

    return `<svg class="plan" data-mode="${model.renderMode}" viewBox="${frame.minX - pad} ${frame.minY - pad} ${width} ${height}" role="img">
      ${
        showRaster && raster
          ? `<image data-testid="plan-raster" href="${escape(raster.dataUrl)}" x="${raster.x}" y="${raster.y}" width="${raster.width}" height="${raster.height}" opacity="${model.renderMode === 'raster' ? 1 : 0.45}" />`
          : ''
      }
      ${showVector ? plan.geometry.rooms.map((r) => `<polygon class="room" points="${points(r)}" />`).join('') : ''}
      ${showVector ? plan.geometry.obstructions.map((o) => `<polygon class="obstruction" points="${points(o)}" />`).join('') : ''}
      ${
        /*
         * A cross rather than a filled dot: a mark that reads at any scale and cannot be mistaken
         * for a machine. Drawn before the equipment so a point under a footprint does not obscure
         * the layout being assessed.
         */
        showVector
          ? plan.geometry.referencePoints
              .map((mark) => {
                const p0 = mark.points[0];
                if (!p0) return '';
                const r = 120;
                return `<g class="reference-point" data-testid="plan-reference-point"><line x1="${p0.x - r}" y1="${p0.y}" x2="${p0.x + r}" y2="${p0.y}" /><line x1="${p0.x}" y1="${p0.y - r}" x2="${p0.x}" y2="${p0.y + r}" /><circle cx="${p0.x}" cy="${p0.y}" r="${r * 0.55}" /></g>`;
              })
              .join('')
          : ''
      }
      ${
        showVector
          ? plan.geometry.equipment
              .map((e) => {
                const cx = e.points.reduce((sum, p) => sum + p.x, 0) / e.points.length;
                const cy = e.points.reduce((sum, p) => sum + p.y, 0) / e.points.length;
                return `<polygon class="equipment" points="${points(e)}" /><text x="${cx}" y="${cy}" class="pin-label">${escape(e.label)}</text>`;
              })
              .join('')
          : ''
      }
    </svg>`;
  };

  const { cover, summary, equipmentSchedule, floorPlans, validation, checklist, installation, datasheets, standards, notice, provenance } = model;

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

${
  model.renderMode === 'raster'
    ? `<p class="warning debug" data-testid="report-debug-mode">${inline('mode_raster_warning')}</p>`
    : ''
}

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
  <h3>${inline('evidence_heading')}</h3>
  <dl class="evidence" data-testid="report-evidence">
    ${field('field_missing_references', num(summary.evidence.missingReferences))}
    ${field('field_missing_citations', num(summary.evidence.missingManufacturerCitations))}
    ${field('field_draft_rules', num(summary.evidence.draftRuleCount))}
  </dl>
  <dl>${field('field_render_mode', inline(`mode_${model.renderMode}` as LabelKey))}</dl>
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
            : `${mm(row.manufacturerDimensions.width)} × ${mm(row.manufacturerDimensions.depth)}${
                row.manufacturerDimensions.height === null
                  ? ''
                  : ` × ${mm(row.manufacturerDimensions.height)}`
              } mm`
        }</td>
        <td class="numeric">${mm(row.designFootprint.width)} × ${mm(row.designFootprint.depth)} mm</td>
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
  ${
    plan.planStatus === 'uncalibrated'
      ? `<p class="warning" data-testid="report-uncalibrated">${inline('not_calibrated')}</p>`
      : plan.planStatus === 'none'
        ? `<p class="empty" data-testid="report-no-drawing">${inline('no_drawing')}</p>`
        : ''
  }
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
    /*
     * Unlike the room and obstruction tables, this one prints when the list is **empty** too —
     * with the sentence saying why. Four scoring criteria measure from these points, so an absent
     * table would read as "nothing to report" when it means "40 % of the score cannot be computed".
     */
    plan.referencePoints.length > 0
      ? `<h4>${inline('table_reference_points')}</h4><table data-testid="report-reference-points"><thead><tr><th>${inline('field_reference_point_kind')}</th><th>${inline('field_label')}</th><th>${inline('field_position')}</th></tr></thead><tbody>${plan.referencePoints
          .map(
            (point) =>
              `<tr><td>${inline(point.kindLabel)}</td><td>${escape(point.label ?? '—')}</td><td class="numeric">${point.position.x}, ${point.position.y} mm</td></tr>`,
          )
          .join('')}</tbody></table>`
      : `<p class="caution" data-testid="report-no-reference-points">${inline('no_reference_points')}</p>`
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

<section data-testid="report-installation">
  ${heading('section_installation')}
  ${
    installation === null
      ? `<p class="empty">${inline('installation_none')}</p>`
      : `
  <dl class="meta">
    ${field('field_sequence_set', `${escape(installation.sequenceSet.id)} v${escape(installation.sequenceSet.version)}`)}
    ${
      /*
       * Owner decision B-7: *"The report must explicitly state 'Planning rate data not available.'
       * instead of displaying calculated numbers."* One sentence, in place of the two figures —
       * not two blanks, which a reader would have to interpret for themselves.
       */
      installation.ratesAvailable
        ? `${field('field_manpower', range(installation.manpower))}
    ${field('field_duration', figure(installation.duration))}`
        : `<div class="field" data-testid="planning-rates-unavailable"><dt>${inline('field_duration')}</dt><dd>${inline('planning_rates_unavailable')}</dd></div>`
    }
  </dl>

  ${
    installation.blockers.length > 0
      ? `<div data-testid="installation-blockers">${heading('block_blockers', 3)}<ul class="blockers">${installation.blockers
          .map(
            (blocker) =>
              `<li data-kind="${escape(blocker.kind)}"><code>${escape(blocker.kind)}</code> <code>${escape(blocker.ref)}</code>${blocker.stageId ? ` → <code>${escape(blocker.stageId)}</code>` : ''}</li>`,
          )
          .join('')}</ul></div>`
      : ''
  }

  <div data-testid="installation-sequence">
    ${heading('block_sequence', 3)}
    ${installation.stages
      .map(
        (stage) => `<div class="stage" data-stage="${escape(stage.id)}">
      <h4><span class="pin">${stage.order}</span> <span class="lead">${escape(stage.title[primary])}</span><span class="alt">${escape(stage.title[secondary])}</span></h4>
      <dl class="meta">
        ${stage.dependsOn.length > 0 ? field('field_depends_on', stage.dependsOn.map((id) => `<code>${escape(id)}</code>`).join(' ')) : ''}
        ${stage.placementNumbers.length > 0 ? field('field_equipment', stage.placementNumbers.map((n) => `<span class="pin">${n}</span>`).join(' ')) : ''}
        ${installation.ratesAvailable ? field('field_manpower', range(stage.manpower)) : ''}
        ${installation.ratesAvailable ? field('field_duration', figure(stage.duration)) : ''}
      </dl>
      ${
        stage.checks.length > 0
          ? `<h5>${inline('field_checks')}</h5><ul class="checklist">${stage.checks
              .map(
                (check) =>
                  `<li><code>${escape(check.id)}</code>${check.text ? bilingualText(check.text.ko, check.text.en) : ''}</li>`,
              )
              .join('')}</ul>`
          : ''
      }
      ${
        stage.tools.length > 0
          ? `<h5>${inline('field_tools')}</h5><table class="bom"><tbody>${stage.tools.map(bomRow).join('')}</tbody></table>`
          : ''
      }
      ${
        stage.materials.length > 0
          ? `<h5>${inline('field_materials')}</h5><table class="bom"><tbody>${stage.materials.map(bomRow).join('')}</tbody></table>`
          : ''
      }
    </div>`,
      )
      .join('')}
  </div>

  <div data-testid="installation-connections">
    ${heading('block_connections', 3)}
    ${installation.connections
      .map(
        (connection) => `<div class="connection" data-service="${escape(connection.service)}">
      <h4>${inline(SERVICE_LABEL[connection.service])}</h4>
      <dl class="meta">
        ${field('field_origin_point', connection.originPointId ? `<code>${escape(connection.originPointId)}</code>` : inline('status_unknown'))}
        ${field('field_total_length', figure(connection.total))}
      </dl>
      ${
        connection.runs.length > 0
          ? `<table class="bom"><thead><tr><th>${inline('field_equipment')}</th><th>${inline('field_run_length')}</th></tr></thead><tbody>${connection.runs
              .map(
                (run) =>
                  `<tr><td><code>${escape(run.placementId)}</code></td><td class="numeric">${figure(run.length)}</td></tr>`,
              )
              .join('')}</tbody></table>`
          : ''
      }
    </div>`,
      )
      .join('')}
  </div>

  <div data-testid="installation-bom">
    ${heading('block_bom', 3)}
    ${
      installation.bom.length === 0
        ? `<p class="empty">${inline('checklist_empty')}</p>`
        : `<table class="bom"><thead><tr><th>${inline('field_materials')}</th><th>${inline('field_category')}</th><th>${inline('field_quantity')}</th></tr></thead><tbody>${installation.bom.map(bomRow).join('')}</tbody></table>`
    }
  </div>

  ${
    installation.risks.length > 0
      ? `<div data-testid="installation-risks">${heading('block_risks', 3)}<ul class="risks">${installation.risks
          .map(
            (risk) =>
              `<li data-origin="${escape(risk.origin)}"><span class="lead">${escape(risk.title[primary])}</span><span class="alt">${escape(risk.title[secondary])}</span> <code>${escape(risk.ref)}</code>${risk.detail ? bilingualText(risk.detail.ko, risk.detail.en) : ''}</li>`,
          )
          .join('')}</ul></div>`
      : ''
  }
  `
  }
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
.mfd-report .plan .reference-point line { stroke: #b45309; stroke-width: 30; }
.mfd-report .plan .reference-point circle { fill: none; stroke: #b45309; stroke-width: 24; }
.mfd-report .caution { border-left: 3px solid #b45309; padding: 6px 10px; margin: 8px 0; font-size: 11px; color: #7c2d12; background: #fffbeb; }
.mfd-report .liability { font-size: 11px; margin: 4px 0; }
.mfd-report .notice { margin-top: 24px; border: 2px solid #111; padding: 10px; }
.mfd-report .provenance { margin-top: 16px; font-size: 10px; color: #6b7280; }
.mfd-report .debug { border: 2px solid #b45309; font-weight: 600; margin: 8px 0; }
`;
