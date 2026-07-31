import type { InstallationPlan, PlanFinding, PlanInput, RoutedLength } from '@mfd/ai-contract';
import { EVALUATION_RESULT_VERSION, type EvaluationReport } from '@mfd/rule-engine';
import { deterministicPlanner } from '@mfd/ai-planner';
import { dialysisSequenceSet } from '@mfd/ai-planner/sequences';
import { boundsOf, routedDistance } from '@mfd/ai-local';
import type { Level, ReferencePoint } from '@mfd/document-model';
import { obstructionBoundaries } from '@mfd/document-model';
import { type Catalog, footprintCorners } from '@mfd/object-library';
import { dialysisChecklistTemplate } from '@mfd/report-engine/checklists';

/**
 * The editor's one call into the planner.
 *
 * Everything the planner needs is assembled here, from the document and the evaluation — so the
 * panel is a list, and this file is the only place that knows the planner's shape.
 *
 * ## No LLM, and no network
 *
 * `@mfd/ai-planner` is pure TypeScript that runs in the browser. There is no fetch here, no model
 * and nothing to configure — the owner's *"must work completely offline, no LLM required, no cloud
 * dependency"* is satisfied by the import list rather than by a policy.
 *
 * ## Why the routed lengths are measured here rather than in the planner
 *
 * `routedDistance` is the solver's geometry, and it is the same routing the engineer saw scored
 * when they approved the layout. A planner that re-derived lengths could disagree with the numbers
 * the approval was given against, which is a quiet way for a document to stop describing the thing
 * it was signed for.
 *
 * A machine with **no route** contributes no entry, and the planner reports `unknown` for it. Not a
 * straight-line fallback: a straight line through a wall is not a shorter route, it is a wrong one,
 * and somebody orders pipe against it.
 */

export interface PlannerRequest {
  readonly projectId: string;
  readonly level: Level;
  readonly spaceId: string | null;
  readonly catalog: Catalog;
  readonly evaluation: EvaluationReport;
  /** The optimisation the layout came from, when it came from one. */
  readonly optimisation: PlanInput['optimisation'];
}

export function runPlanner(request: PlannerRequest): InstallationPlan {
  return deterministicPlanner(dialysisSequenceSet).plan(planInput(request));
}

/**
 * Assemble the planner's input.
 *
 * Exported so the tests can look at what the editor actually hands over. The `evaluation` field is
 * required by the type, which is how *"never plan directly from raw user drawings"* is held: there
 * is no way to build this object without one.
 */
export function planInput(request: PlannerRequest): PlanInput {
  const { level, catalog, evaluation } = request;

  const equipmentIds = [...new Set(level.placements.map((p) => p.equipmentObjectId))];

  return {
    projectId: request.projectId,
    levelId: level.id,
    spaceId: request.spaceId,
    placements: level.placements.map((placement) => ({
      placementId: placement.id,
      equipmentObjectId: placement.equipmentObjectId,
      position: placement.transform.position,
      rotation: placement.transform.rotation,
      spaceId: placement.spaceId,
    })),
    equipment: equipmentIds.flatMap((id) => {
      const object = catalog.get(id);
      if (!object) return [];
      return [
        {
          id: object.id,
          version: object.version,
          model: object.model,
          /*
           * The record's own verification state, carried so a figure taken from it inherits it. A
           * planner told everything is verified would report a material quantity as established
           * when the catalogue entry it rests on is a placeholder.
           */
          dataStatus: hasDraft(object) ? ('draft' as const) : ('verified' as const),
          connections: (['power', 'ro_water', 'drain'] as const).map((service) => {
            const entry = object.connections[connectionKey(service)];
            return {
              service,
              required: entry.required,
              specified: entry.specification !== null,
              status: entry.verification.status === 'verified' ? ('verified' as const) : ('draft' as const),
            };
          }),
        },
      ];
    }),
    referencePoints: level.referencePoints.map((point) => ({
      id: point.id,
      kind: point.kind,
      position: point.position,
    })),
    evaluation: {
      version: EVALUATION_RESULT_VERSION,
      ruleSet: { id: evaluation.ruleSetId, version: evaluation.ruleSetVersion },
      red: evaluation.counts.RED ?? 0,
      yellow: evaluation.counts.YELLOW ?? 0,
      green: evaluation.counts.GREEN ?? 0,
      openFindings: evaluation.results.map(
        (result): PlanFinding => ({
          ruleId: result.ruleId,
          reasonCode: result.reasonCode,
          level: result.level,
          placementId: result.placementIds[0] ?? null,
        }),
      ),
    },
    optimisation: request.optimisation,
    routedLengths: routeAll(level, catalog),
    checklistItemIds: dialysisChecklistTemplate.categories.flatMap((category) =>
      category.items.map((item) => item.id),
    ),
    planStatus: level.planImage === null ? 'none' : level.coordinateMapping === null ? 'uncalibrated' : 'calibrated',
  };
}

/** Which service routes from which reference point kind. */
const ORIGIN_KIND = {
  power: 'electrical_panel',
  ro_water: 'ro_supply',
  drain: 'drain',
} as const satisfies Record<RoutedLength['service'], ReferencePoint['kind']>;

/**
 * Route every machine to every service origin it has.
 *
 * The obstructions are the level's own — columns, shafts, anything the router must go around — plus
 * the other machines' footprints. A cable that runs through a dialysis machine is not a shorter
 * cable.
 */
function routeAll(level: Level, catalog: Catalog): RoutedLength[] {
  interface Obstacle {
    /** The placement this rectangle belongs to, or null for a column or shaft. */
    readonly placementId: string | null;
    readonly bounds: ReturnType<typeof boundsOf>;
  }

  const obstacles: Obstacle[] = [
    ...obstructionBoundaries(level).map((boundary) => ({
      placementId: null,
      bounds: boundsOf(boundary.vertices),
    })),
    ...level.placements.map((placement) => {
      const object = catalog.get(placement.equipmentObjectId);
      return {
        placementId: placement.id,
        bounds: object ? boundsOf(footprintCorners(object, placement.transform)) : null,
      };
    }),
  ];

  /*
   * The search area: everything on the level, with room to spare.
   *
   * Wide rather than the room outline, because a service origin is often *outside* the room — a
   * panel in the corridor, a drain in a riser — and a search area that stopped at the wall would
   * report no route to a machine four metres away.
   */
  const within = boundsOf([
    ...level.boundaries.flatMap((boundary) => boundary.vertices),
    ...level.placements.map((placement) => placement.transform.position),
    ...level.referencePoints.map((point) => point.position),
  ]);
  if (!within) return [];
  const padded = {
    minX: within.minX - 2_000,
    minY: within.minY - 2_000,
    maxX: within.maxX + 2_000,
    maxY: within.maxY + 2_000,
  };

  const out: RoutedLength[] = [];

  for (const [service, kind] of Object.entries(ORIGIN_KIND) as [
    RoutedLength['service'],
    ReferencePoint['kind'],
  ][]) {
    const origin = level.referencePoints.find((point) => point.kind === kind);
    if (!origin) continue;

    for (const placement of level.placements) {
      const distance = routedDistance({
        from: origin.position,
        to: placement.transform.position,
        // The machine being routed *to* is not an obstacle to its own cable.
        blocked: obstacles.flatMap((entry) =>
          entry.placementId === placement.id || entry.bounds === null ? [] : [entry.bounds],
        ),
        within: padded,
      });
      // No route: no entry, so the planner says `unknown` and the panel says which machine.
      if (distance === null) continue;
      out.push({
        service,
        placementId: placement.id,
        originPointId: origin.id,
        millimetres: Math.round(distance),
      });
    }
  }

  return out;
}

function connectionKey(service: RoutedLength['service']): 'power' | 'roWater' | 'drain' {
  if (service === 'ro_water') return 'roWater';
  return service;
}

function hasDraft(object: { readonly connections: Record<string, { readonly verification: { readonly status: string } }> }): boolean {
  return Object.values(object.connections).some((entry) => entry.verification.status !== 'verified');
}
