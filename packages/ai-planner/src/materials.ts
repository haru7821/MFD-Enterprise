import type { PlanInput, PlanResource, PlanService } from '@mfd/ai-contract';
import { calculatedNumber, statedNumber, unknownNumber } from '@mfd/ai-contract';

import type { SequenceStage } from './sequenceSet';

/**
 * Tools and materials — the owner's Sprint 6 § 8, and the bill of materials of § 9.
 *
 * ## Where each half comes from, and why they come from different places
 *
 * | | Declared in | Because |
 * | --- | --- | --- |
 * | **Tools** | the sequence file, each naming the checklist item that entails it | A pressure gauge is needed *because* a check says to confirm loop pressure. That is site practice, and site practice is data a customer may edit |
 * | **Materials** | the equipment record's `connections` group | *"Each machine needs one power connection"* is a fact about the machine, not about the site. Declaring it in the sequence file would let one customer's file quietly disagree with the catalogue |
 *
 * The sequence file says only **which stage** the service materials belong to, and the schema
 * requires exactly one stage to claim them: zero would drop them from the BOM, two would order
 * everything twice.
 *
 * ## Quantities are calculated and say so
 *
 * "Twelve power connection sets" is arithmetic over two inputs — the catalogue saying power is
 * required, and the drawing holding twelve machines — and both are named on the figure. What is
 * *not* stated is the specification: the catalogue leaves `specification: null` because the AK98
 * manual has not been supplied, so a buyer is told how many and told to ask what kind. That is a
 * purchasable answer. A guessed cable size is not.
 */

const SERVICE_TITLES: Readonly<Record<PlanService, { ko: string; en: string }>> = {
  power: { ko: '전원 접속 세트', en: 'Power Connection Set' },
  ro_water: { ko: 'RO 급수 접속 세트', en: 'RO Water Connection Set' },
  drain: { ko: '배수 접속 세트', en: 'Drain Connection Set' },
};

/** The tools a stage needs, quantified against the machine count where the file says per station. */
export function toolsFor(stage: SequenceStage, stationCount: number): PlanResource[] {
  return stage.tools.map((tool) => ({
    id: tool.id,
    title: tool.title,
    quantity: quantityOf(tool, stationCount, `sequence_set:${stage.id}.tools.${tool.id}`),
  }));
}

/**
 * The per-machine service connections, on the one stage that carries them.
 *
 * Grouped by service across equipment kinds: a ward with twelve dialysis machines and three beds
 * needs one power connection list, not two. The inputs name every catalogue record that contributed
 * to the count, so a reader can see which equipment the fifteen came from.
 */
export function materialsFor(stage: SequenceStage, input: PlanInput): PlanResource[] {
  const declared = stage.materials.map((entry) => ({
    id: entry.id,
    title: entry.title,
    quantity: quantityOf(
      entry,
      input.placements.length,
      `sequence_set:${stage.id}.materials.${entry.id}`,
    ),
  }));

  if (!stage.carriesServiceMaterials) return declared;

  interface ServiceTotal {
    count: number;
    /** Which equipment record contributed how many, so the sum can be checked line by line. */
    contributors: { equipmentId: string; count: number }[];
  }

  const byService = new Map<PlanService, ServiceTotal>();

  for (const equipment of input.equipment) {
    const count = input.placements.filter(
      (placement) => placement.equipmentObjectId === equipment.id,
    ).length;
    if (count === 0) continue;

    for (const connection of equipment.connections) {
      if (!connection.required) continue;
      const entry = byService.get(connection.service) ?? { count: 0, contributors: [] };
      entry.count += count;
      entry.contributors.push({ equipmentId: equipment.id, count });
      byService.set(connection.service, entry);
    }
  }

  const services: PlanResource[] = [...byService.entries()]
    // Sorted by service name so two runs produce the same BOM order. `Map` iteration is insertion
    // order, which would make the BOM depend on which machine happened to be placed first.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([service, entry]) => ({
      id: `${service}_connection_set`,
      title: SERVICE_TITLES[service],
      quantity: calculatedNumber(entry.count, 'each', `bom:${service}_connection_set`, {
        formula: 'Σ (machines of each kind requiring this service)',
        inputs: [
          ...entry.contributors.map((contributor) => ({
            name: contributor.equipmentId,
            value: contributor.count,
            unit: 'each',
            ref: `catalogue_field:${contributor.equipmentId}.connections.${service}`,
          })),
        ],
        rateId: null,
        citation: null,
      }),
    }));

  return [...declared, ...services];
}

/** Aggregate the stages' materials into one bill, summing quantities that share an id. */
export function billOfMaterials(perStage: readonly (readonly PlanResource[])[]): PlanResource[] {
  const totals = new Map<string, PlanResource>();

  for (const resource of perStage.flat()) {
    const existing = totals.get(resource.id);
    if (!existing) {
      totals.set(resource.id, resource);
      continue;
    }

    /*
     * Two lines for the same material, and one of them unknown. The sum is unknown — not the known
     * half. A BOM that quietly reported the part it could count would be an order short by exactly
     * the amount nobody noticed.
     */
    const a = existing.quantity.value;
    const b = resource.quantity.value;
    totals.set(resource.id, {
      ...existing,
      quantity:
        a === null || b === null
          ? unknownNumber(existing.quantity.unit, `bom:${resource.id}:incomplete`)
          : calculatedNumber(a + b, existing.quantity.unit, `bom:${resource.id}`, {
              formula: 'Σ stage quantities',
              inputs: [
                ...(existing.quantity.calculation?.inputs ?? []),
                ...(resource.quantity.calculation?.inputs ?? []),
              ],
              rateId: null,
              citation: null,
            }),
    });
  }

  return [...totals.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A declared tool or material's quantity: fixed per stage, or one per machine. */
function quantityOf(
  entry: { readonly per: 'stage' | 'station'; readonly quantity: number | null },
  stationCount: number,
  ref: string,
) {
  if (entry.quantity === null) return unknownNumber('each', ref);
  if (entry.per === 'stage') {
    return statedNumber(entry.quantity, 'each', 'sequence_set', ref, 'planning');
  }
  return calculatedNumber(entry.quantity * stationCount, 'each', ref, {
    formula: 'quantityPerStation × stationCount',
    inputs: [
      { name: 'quantityPerStation', value: entry.quantity, unit: 'each', ref },
      {
        name: 'stationCount',
        value: stationCount,
        unit: 'count',
        ref: 'measurement:placement_count',
      },
    ],
    rateId: null,
    citation: null,
  });
}
