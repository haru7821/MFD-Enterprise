import type { PlanInput } from '@mfd/ai-contract';

/**
 * A validated three-station layout, as the planner sees one.
 *
 * Hand-built rather than run through the solver: this package tests what it does with a plan, and a
 * fixture that ran the solver would make a report test fail when the solver's ranking changed.
 */
export function fixturePlanInput(overrides: Partial<PlanInput> = {}): PlanInput {
  const placements = ['station_1', 'station_2', 'station_3'].map((id, index) => ({
    placementId: id,
    equipmentObjectId: 'vantive_ak98',
    position: { x: 1_000 + index * 1_000, y: 1_000 },
    rotation: 0,
    spaceId: 'space_1',
  }));

  return {
    projectId: 'project_1',
    levelId: 'level_1',
    spaceId: 'space_1',
    placements,
    equipment: [
      {
        id: 'vantive_ak98',
        version: '0.1.0',
        model: 'AK98',
        dataStatus: 'draft',
        connections: [
          { service: 'power', required: true, specified: false, status: 'draft' },
          { service: 'ro_water', required: true, specified: false, status: 'draft' },
          { service: 'drain', required: true, specified: false, status: 'draft' },
        ],
      },
    ],
    referencePoints: [
      { id: 'point_ro', kind: 'ro_supply', position: { x: 0, y: 0 } },
      { id: 'point_panel', kind: 'electrical_panel', position: { x: 8_000, y: 0 } },
      { id: 'point_drain', kind: 'drain', position: { x: 0, y: 6_000 } },
    ],
    evaluation: {
      version: 2,
      ruleSet: { id: 'dialysis', version: '0.1.0' },
      red: 0,
      yellow: 0,
      green: 0,
      openFindings: [],
    },
    optimisation: null,
    routedLengths: placements.flatMap((placement, index) =>
      (['power', 'ro_water', 'drain'] as const).map((service) => ({
        service,
        placementId: placement.placementId,
        originPointId:
          service === 'power' ? 'point_panel' : service === 'ro_water' ? 'point_ro' : 'point_drain',
        millimetres: 1_000 * (index + 1),
      })),
    ),
    checklistItemIds: [
      'supply_capacity',
      'outlet_position',
      'earthing',
      'loop_pressure',
      'connection_point',
      'water_quality',
      'drain_capacity',
      'air_gap',
      'data_point',
      'segregation',
      'bed_route',
      'evacuation',
      'staff_observation',
      'as_built',
      'manual_reference',
      'sign_off',
    ],
    planStatus: 'none',
    ...overrides,
  };
}
