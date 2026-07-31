import type {
  ConnectionPlan,
  ConnectionRun,
  PlanInput,
  PlanService,
  ReferencePointSummary,
  SourcedNumber,
  SourcedText,
} from '@mfd/ai-contract';
import { PLAN_SERVICES, measuredNumber, unknownNumber, unknownText } from '@mfd/ai-contract';

/**
 * The power, RO and drain connection plans — the owner's Sprint 6 § 3.
 *
 * ## Three plans, always, even when a service has nothing behind it
 *
 * A plan that omitted drain because nobody placed the reference point would read as a project with
 * no drain requirement, and a reader has no way to tell that apart from a project whose drain was
 * considered and needs nothing. So all three are always present, and a service with no origin says
 * so: `originPointId: null`, no runs, an `unknown` total naming the missing point.
 *
 * ## Lengths are measured, never derived
 *
 * The routed lengths come in on {@link PlanInput.routedLengths}, measured by the caller with the
 * same routing the engineer saw when they approved the layout. Two consequences, both deliberate:
 *
 * - A machine with no entry gets `unknown`, **not** a straight-line distance. A straight line
 *   through a wall is not a shorter route, it is a wrong one, and a buyer ordering pipe from it
 *   orders too little.
 * - Every length is `planning`, never `verified` (EV-5). It is a fact about a drawing, and a
 *   drawing is not a site survey.
 */

export function buildConnections(input: PlanInput): ConnectionPlan[] {
  return PLAN_SERVICES.map((service) => planFor(service, input));
}

/** Which reference point kind each service routes from. */
const ORIGIN_KIND: Readonly<Record<PlanService, ReferencePointSummary['kind']>> = {
  power: 'electrical_panel',
  ro_water: 'ro_supply',
  drain: 'drain',
};

function planFor(service: PlanService, input: PlanInput): ConnectionPlan {
  const origin = input.referencePoints.find((point) => point.kind === ORIGIN_KIND[service]);

  if (!origin) {
    return {
      service,
      originPointId: null,
      runs: [],
      totalLength: unknownNumber('mm', `reference_point:${ORIGIN_KIND[service]}`),
    };
  }

  const runs: ConnectionRun[] = input.placements.map((placement) => {
    const measured = input.routedLengths.find(
      (entry) =>
        entry.service === service &&
        entry.placementId === placement.placementId &&
        entry.originPointId === origin.id,
    );

    return {
      placementId: placement.placementId,
      length: measured
        ? measuredNumber(measured.millimetres, 'mm', `route:${service}:${placement.placementId}`)
        : unknownNumber('mm', `route:${service}:${placement.placementId}`),
      /*
       * What fitting, at what rating.
       *
       * `unknown` when the catalogue states nothing — which is every record today, because the AK98
       * manual has not been supplied (A-1) — naming the field group that would answer it.
       *
       * When the catalogue *does* state one, this points at the datasheet rather than repeating the
       * figures. That is a cross-reference, not an engineering claim: the loose specification record
       * is printed properly in the report's datasheet section, and a second rendering here would be
       * the one an engineer on site happened to be holding.
       */
      requirement: requirementFor(service, placement.equipmentObjectId, input),
    };
  });

  return { service, originPointId: origin.id, runs, totalLength: sumLengths(runs, service) };
}

/** Where to find the connection specification, or `unknown` when there is none to find. */
function requirementFor(service: PlanService, equipmentId: string, input: PlanInput): SourcedText {
  const ref = `catalogue_field:${equipmentId}.connections.${service}`;
  const declared = input.equipment
    .find((entry) => entry.id === equipmentId)
    ?.connections.find((entry) => entry.service === service);

  if (!declared?.specified) return unknownText(ref);

  return {
    value: {
      ko: '장비 데이터시트의 접속 사양을 따릅니다.',
      en: 'Per the connection specification in the equipment datasheet.',
    },
    status: declared.status === 'verified' ? 'verified' : 'draft',
    source: { kind: 'catalogue_field', ref, inputs: [] },
  };
}

/**
 * The total, or `unknown` if any run is.
 *
 * **Not the sum of what happened to be measurable.** A total over a subset is the most misleading
 * number this file could produce: it is smaller than the truth, it looks complete, and somebody
 * orders pipe against it. If one machine could not be routed, the total is unknown and the runs
 * below show which.
 */
function sumLengths(runs: readonly ConnectionRun[], service: PlanService): SourcedNumber {
  if (runs.length === 0) return unknownNumber('mm', `route:${service}`);

  const values = runs.map((run) => run.length.value);
  if (values.some((value) => value === null)) {
    return unknownNumber('mm', `route:${service}:incomplete`);
  }

  const total = values.reduce((sum: number, value) => sum + (value ?? 0), 0);
  return {
    value: total,
    unit: 'mm',
    status: 'calculated',
    source: {
      kind: 'derived',
      ref: `route:${service}:total`,
      inputs: runs.map((run) => `route:${service}:${run.placementId}`),
    },
  };
}
