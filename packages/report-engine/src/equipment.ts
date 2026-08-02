import type { Placement } from '@mfd/document-model';
import {
  CONNECTION_KINDS,
  FIELD_GROUP_ORIGIN,
  VERIFIED_FIELD_GROUPS,
  type Catalog,
  type ConnectionKind,
  type EquipmentObject,
  type VerifiedFieldGroup,
  fieldVerification,
  isSourced,
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
  // `isSourced`, not `=== 'verified'`: a datasheet-sourced group names a document, a revision and
  // a section like any other, and dropping its citation would print a figure the report could no
  // longer stand behind.
  if (!isSourced(status)) return null;

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
    // Codepoint order: `localeCompare` reads the runtime's locale, so the same document would
    // render its equipment table in a different order on a different machine. Banned repo-wide by
    // `packages/document-model/src/isomorphism.test.ts`.
    .sort((a, b) => (a.object.model < b.object.model ? -1 : a.object.model > b.object.model ? 1 : 0));

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
        planningFootprint: {
          width: object.planningFootprint.width,
          depth: object.planningFootprint.depth,
          basis: object.planningFootprint.basis,
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
    case 'serviceClearance':
      return [{ label: 'group_serviceClearance', value: sidesOf(object.serviceClearance) }];
    case 'maintenanceAccess':
      return [{ label: 'group_maintenanceAccess', value: sidesOf(object.maintenanceAccess) }];
    case 'portLocations':
      return [{ label: 'group_portLocations', value: portsOf(object) }];
    case 'installationRouting':
      return [
        {
          label: 'group_installationRouting',
          value: formatSpecification(object.installationRouting.specification),
        },
      ];
  }
}

function sidesOf(group: { front: number | null; rear: number | null; left: number | null; right: number | null }): string | null {
  return sides(group.front, group.rear, group.left, group.right);
}

/**
 * Where each service lands on the machine, in the object's own millimetres.
 *
 * Null when no port has been located, which is every record today: these are installation data,
 * and the owner's AK98 source clarification put them beyond the reach of the equipment manual.
 */
function portsOf(object: EquipmentObject): string | null {
  const entries = CONNECTION_KINDS.map((kind) => [kind, object.portLocations[kind]] as const)
    .filter((entry): entry is readonly [ConnectionKind, { x: number; y: number }] => entry[1] !== null)
    .map(([kind, position]) => `${kind} (${position.x}, ${position.y}) mm`);

  return entries.length === 0 ? null : entries.join(' · ');
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
  /*
   * Partitioned on *sourced or not*, rather than on the literal `verified`. With three statuses a
   * `=== 'verified'` test would have quietly filed every datasheet-sourced group under "draft
   * data", which is the opposite of what the owner's clarification says about the AK98 datasheet.
   */
  const blocks = (
    include: (group: VerifiedFieldGroup) => boolean,
  ): DatasheetBlock[] =>
    VERIFIED_FIELD_GROUPS.filter(include).map((group) => ({
      group: groupLabelKey(group),
      citation: citationOf(object, group),
      fields: fieldsFor(object, group),
    }));

  return {
    equipmentId: object.id,
    model: object.model,
    manufacturer: object.manufacturer,
    catalogueVersion: object.version,
    specification_data: blocks(
      (group) =>
        isSourced(fieldVerification(object, group).status) &&
        FIELD_GROUP_ORIGIN[group] === 'specification',
    ),
    installation_data: blocks(
      (group) =>
        isSourced(fieldVerification(object, group).status) &&
        FIELD_GROUP_ORIGIN[group] === 'installation',
    ),
    planningFootprint: [
      {
        label: 'field_planning_footprint',
        value: `${object.planningFootprint.width} × ${object.planningFootprint.depth} mm`,
      },
      { label: 'field_footprint_basis', value: object.planningFootprint.basis },
    ],
    draft_data: blocks((group) => !isSourced(fieldVerification(object, group).status)),
  };
}
