import { CatalogValidationError, DuplicateEquipmentIdError, type CatalogIssue } from './errors';
import { type EquipmentObject, equipmentObjectSchema, hasDraftFields } from './schema';

/**
 * Catalogue loading.
 *
 * The loader takes already-read JSON rather than reading files itself, which keeps
 * this package free of any filesystem or bundler API — it runs identically in a
 * browser, a Node process and a test runner.
 */

export interface CatalogSource {
  /** Used in error messages so a broken record can be found on disk. */
  readonly fileName: string;
  readonly raw: unknown;
}

/**
 * Validate one catalogue record.
 *
 * @throws {CatalogValidationError} when the record does not satisfy the schema.
 */
export function parseEquipmentObject(raw: unknown, fileName: string): EquipmentObject {
  const result = equipmentObjectSchema.safeParse(raw);

  if (!result.success) {
    const issues: CatalogIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new CatalogValidationError(fileName, issues);
  }

  return result.data;
}

export interface Catalog {
  readonly objects: readonly EquipmentObject[];
  /** Undefined when no record has this id. */
  get(equipmentObjectId: string): EquipmentObject | undefined;
  /** Throws when no record has this id — use where absence is a bug, not a case. */
  require(equipmentObjectId: string): EquipmentObject;
  /** Records still carrying placeholder figures. */
  /** Records with **any** draft field group. For marking the interface, not for verdicts. */
  readonly draftObjects: readonly EquipmentObject[];
}

/**
 * Build a catalogue from raw records.
 *
 * Fails on the first invalid record and on any duplicate id. A catalogue that
 * silently drops a bad record is worse than one that refuses to load: the engineer
 * would see a shorter equipment list and no reason why.
 */
export function createCatalog(sources: readonly CatalogSource[]): Catalog {
  const byId = new Map<string, EquipmentObject>();
  const fileNamesById = new Map<string, string[]>();

  for (const source of sources) {
    const object = parseEquipmentObject(source.raw, source.fileName);

    const seenIn = fileNamesById.get(object.id);
    if (seenIn) {
      seenIn.push(source.fileName);
      throw new DuplicateEquipmentIdError(object.id, seenIn);
    }

    fileNamesById.set(object.id, [source.fileName]);
    byId.set(object.id, object);
  }

  const objects = [...byId.values()];

  return {
    objects,
    get: (equipmentObjectId) => byId.get(equipmentObjectId),
    require: (equipmentObjectId) => {
      const object = byId.get(equipmentObjectId);
      if (!object) {
        throw new Error(`Unknown equipment object: "${equipmentObjectId}"`);
      }
      return object;
    },
    draftObjects: objects.filter(hasDraftFields),
  };
}
