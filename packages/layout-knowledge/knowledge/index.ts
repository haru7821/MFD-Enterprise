import { createKnowledgeBase, type KnowledgeBase } from '../src/query';
import { parseDataset, parseKnowledgeFile } from '../src/load';
import type { Dataset } from '../src/schema';

import dataset from '../../../knowledge/dataset.json';
import circulationPath from '../../../knowledge/derived/circulation-path.json';
import commonDimension from '../../../knowledge/derived/common-dimension.json';
import drainRouting from '../../../knowledge/derived/drain-routing.json';
import electricalRouting from '../../../knowledge/derived/electrical-routing.json';
import equipmentPlacement from '../../../knowledge/derived/equipment-placement.json';
import geometricPattern from '../../../knowledge/derived/geometric-pattern.json';
import roRoomPattern from '../../../knowledge/derived/ro-room-pattern.json';
import roomType from '../../../knowledge/derived/room-type.json';
import stationLayout from '../../../knowledge/derived/station-layout.json';

/**
 * The shipped knowledge base.
 *
 * Loaded from `knowledge/` at the repository root, beside `standards/` and deliberately not inside
 * it. AD-4 makes `standards/` the source of record for engineering **rules**; observed practice is
 * not a rule, and putting it there would blur what that directory means to anyone reading it. The
 * separation is visible in the filesystem because it is the distinction the whole package rests on.
 *
 * Files are imported statically so a bundler sees each one and validation runs at module load: a
 * malformed derived file fails when the application starts, not the first time the solver asks it
 * a question.
 *
 * ## Every file is empty
 *
 * The dataset repository has not been provided. `knowledge/dataset.json` catalogues no drawings,
 * no observations have been recorded, and every derived file holds `entries: []`.
 *
 * That is the correct state, not a stub to be filled in with something plausible. An empty
 * knowledge base makes `dimension()` return null, which makes the solver report a criterion as
 * unavailable — the same answer the rule engine gives for a missing threshold, and for the same
 * reason. Seeding it with typical figures from memory would produce a base that looks populated,
 * cites nothing, and moves layouts.
 *
 * It resolves the way the rule set does: add observation files, regenerate, commit. No code moves.
 */
export const dialysisKnowledge: KnowledgeBase = createKnowledgeBase([
  parseKnowledgeFile(roomType, 'knowledge/derived/room-type.json'),
  parseKnowledgeFile(equipmentPlacement, 'knowledge/derived/equipment-placement.json'),
  parseKnowledgeFile(stationLayout, 'knowledge/derived/station-layout.json'),
  parseKnowledgeFile(circulationPath, 'knowledge/derived/circulation-path.json'),
  parseKnowledgeFile(roRoomPattern, 'knowledge/derived/ro-room-pattern.json'),
  parseKnowledgeFile(drainRouting, 'knowledge/derived/drain-routing.json'),
  parseKnowledgeFile(electricalRouting, 'knowledge/derived/electrical-routing.json'),
  parseKnowledgeFile(commonDimension, 'knowledge/derived/common-dimension.json'),
  parseKnowledgeFile(geometricPattern, 'knowledge/derived/geometric-pattern.json'),
]);

/** The dataset the observations were read from. No drawings catalogued yet. */
export const dialysisDataset: Dataset = parseDataset(dataset);
