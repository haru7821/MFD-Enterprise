import type { Placement } from '@mfd/document-model';
import {
  VERIFIED_FIELD_GROUPS,
  type Catalog,
  type EquipmentObject,
  type VerifiedFieldGroup,
  fieldVerification,
} from '@mfd/object-library';

import { groupLabelKey } from './groups';
import type {
  DatasheetBlock,
  DatasheetField,
  DatasheetSection,
  Dimensions,
  EquipmentScheduleRow,
  EquipmentScheduleSection,
  FieldGroupStatus,
} from './model';

/**
 * Sections 3 and 7 — the equipment schedule and the datasheets.
 *
 * Both read the same records, and they answer different questions, which is why they are
 * two sections rather than one wide table:
 *
 * | Section | The reader is |
 * | --- | --- |
 * | Schedule | Ordering equipment, or checking a delivery. One row per model. |
 * | Datasheet | Asking what is actually known about this model, and on whose authority |
 *
 * ## The three-block rule
 *
 * Owner decision: *"Never mix manufacturer data with planning data."* A datasheet is
 * therefore three separate blocks, and the third is the one that is easy to get wrong:
 *
 * - **Manufacturer data** — cited figures, each group naming its document.
 * - **Design footprint** — the owner's planning decision. No citation, by design.
 * - **Draft data** — figures with no manual reference yet.
 *
 * The footprint is neither verified nor draft. Filing it under "draft" would read as a
 * figure nobody had got round to sourcing; filing it under "manufacturer data" would be a
 * false citation. It gets its own block, labelled as a planning decision.
 */

/** "AK 98 Operator Manual · Rev 04 · §15", or null when the group cites nothing. */
export function citationOf(object: EquipmentObject, group: VerifiedFieldGroup): string | null {
  const { status, source } = fieldVerification(object, group);
  if (status !== 'verified') return null;

  return [source.document, source.revision, source.section].filter(Boolean).join(' · ');
}

function dimensionsOf(object: EquipmentObject): Dimensions | null {
  const { width, depth, height, weight } = object.manufacturerDimensions;
  // A record with no manufacturer figures at all is a generic planning object. Null rather
  // than a row of nulls: an absent block says "this is not a product", and four empty
  // fields say "somebody has not filled this in".
  if (width === null && depth === null && height === null && weight === null) return null;

  return { width, depth, height, weight };
}

function verificationOf(object: EquipmentObject): FieldGroupStatus[] {
  return VERIFIED_FIELD_GROUPS.map((group) => ({
    group: groupLabelKey(group),
    status: fieldVerification(object, group).status,
    citation: citationOf(object, group),
  }));
}

export interface EquipmentUsage {
  readonly object: EquipmentObject;
  readonly quantity: number;
}

/**
 * Which models are in use, across **every** level, with counts.
 *
 * Project-wide on purpose: an engineer ordering equipment wants one number per model for
 * the whole job. The per-level view is the placement table, and merging the two would
 * serve neither.
 */
export function equipmentUsage(
  placements: readonly Placement[],
  catalog: Catalog,
): { readonly usage: readonly EquipmentUsage[]; readonly unknownEquipmentIds: string[] } {
  const counts = new Map<string, number>();
  const unknown = new Set<string>();

  for (const placement of placements) {
    if (catalog.get(placement.equipmentObjectId)) {
      counts.set(
        placement.equipmentObjectId,
        (counts.get(placement.equipmentObjectId) ?? 0) + 1,
      );
    } else {
      // Surfaced, never dropped. A machine missing from a schedule is a machine nobody
      // orders, and a placement pointing at a deleted catalogue record is a data problem
      // the report should name rather than hide.
      unknown.add(placement.equipmentObjectId);
    }
  }

  const usage = [...counts.entries()]
    .map(([id, quantity]) => ({ object: catalog.require(id), quantity }))
    .sort((a, b) => a.object.model.localeCompare(b.object.model));

  return { usage, unknownEquipmentIds: [...unknown].sort() };
}

export function buildEquipmentSchedule(
  usage: readonly EquipmentUsage[],
  unknownEquipmentIds: readonly string[],
): EquipmentScheduleSection {
  return {
    rows: usage.map(
      ({ object, quantity }): EquipmentScheduleRow => ({
        equipmentId: object.id,
        manufacturer: object.manufacturer,
        model: object.model,
        catalogueVersion: object.version,
        quantity,
        manufacturerDimensions: dimensionsOf(object),
        designFootprint: {
          width: object.designFootprint.width,
          depth: object.designFootprint.depth,
          basis: object.designFootprint.basis,
        },
        verification: verificationOf(object),
      }),
    ),
    unknownEquipmentIds: [...unknownEquipmentIds],
  };
}

/** Format a millimetre figure, or null when it is unknown. */
function mm(value: number | null): string | null {
  return value === null ? null : `${value.toLocaleString('en-US')} mm`;
}

function dimensionFields(object: EquipmentObject): DatasheetField[] {
  const { width, depth, height, weight } = object.manufacturerDimensions;
  const size =
    width === null || depth === null
      ? null
      : height === null
        ? `${width} × ${depth} mm`
        : `${width} × ${depth} × ${height} mm`;

  return [
    { label: 'field_manufacturer_dimensions', value: size },
    { label: 'field_height', value: mm(height) },
    { label: 'field_weight', value: weight === null ? null : `${weight} kg` },
  ];
}

function sides(
  front: number | null,
  rear: number | null,
  left: number | null,
  right: number | null,
): string | null {
  if (front === null && rear === null && left === null && right === null) return null;
  const part = (name: string, value: number | null) =>
    value === null ? `${name} —` : `${name} ${value} mm`;
  return [
    part('front', front),
    part('rear', rear),
    part('left', left),
    part('right', right),
  ].join(' · ');
}

/** A group's fields, formatted. One place, so the schedule and the datasheet agree. */
function fieldsFor(object: EquipmentObject, group: VerifiedFieldGroup): DatasheetField[] {
  switch (group) {
    case 'manufacturerDimensions':
      return dimensionFields(object);
    case 'serviceClearance':
      return [{ label: 'group_serviceClearance', value: sidesOf(object) }];
    case 'power':
    case 'roWater':
    case 'drain':
      return [{ label: groupLabelKey(group), value: specificationOf(object, group) }];
    case 'environmental':
      return [
        {
          label: 'group_environmental',
          value: formatSpecification(object.environmental.specification),
        },
      ];
  }
}

function sidesOf(object: EquipmentObject): string | null {
  const { front, rear, left, right } = object.serviceClearance;
  return sides(front, rear, left, right);
}

function specificationOf(
  object: EquipmentObject,
  group: 'power' | 'roWater' | 'drain',
): string | null {
  const connection = object.connections[group];
  const specification = formatSpecification(connection.specification);
  // "Required, specification unknown" is a different statement from "not required", and an
  // engineer sizing a supply needs to be able to tell them apart.
  if (specification === null) return connection.required ? null : 'not required';
  return specification;
}

function formatSpecification(
  specification: Readonly<Record<string, unknown>> | null,
): string | null {
  if (!specification) return null;
  const entries = Object.entries(specification);
  if (entries.length === 0) return null;
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ');
}

export function buildDatasheet(object: EquipmentObject): DatasheetSection {
  const blocks = (status: 'verified' | 'draft'): DatasheetBlock[] =>
    VERIFIED_FIELD_GROUPS.filter(
      (group) => fieldVerification(object, group).status === status,
    ).map((group) => ({
      group: groupLabelKey(group),
      citation: citationOf(object, group),
      fields: fieldsFor(object, group),
    }));

  return {
    equipmentId: object.id,
    model: object.model,
    manufacturer: object.manufacturer,
    catalogueVersion: object.version,
    manufacturer_data: blocks('verified'),
    designFootprint: [
      {
        label: 'field_design_footprint',
        value: `${object.designFootprint.width} × ${object.designFootprint.depth} mm`,
      },
      { label: 'field_footprint_basis', value: object.designFootprint.basis },
    ],
    draft_data: blocks('draft'),
  };
}
