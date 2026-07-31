import type {
  ConnectionPlan,
  ConnectionRun,
  PlanInput,
  PlanService,
  ReferencePointSummary,
  SourcedNumber,
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
       * What fitting, at what rating. The catalogue declares the connection is *required* and
       * leaves `specification: null` — the AK98 manual has not been supplied (A-1) — so this is
       * `unknown` on every project today, and it says which record would answer it.
       */
      requirement: unknownText(`catalogue_field:${placement.equipmentObjectId}.connections.${service}`),
    };
  });

  return { service, originPointId: origin.id, runs, totalLength: sumLengths(runs, service) };
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
