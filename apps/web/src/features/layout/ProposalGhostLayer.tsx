import { Fragment } from 'react';
import { Line, Text } from 'react-konva';

import type { PlacementChange, PlacementDiffEntry } from '@mfd/ai-local';
import { type Viewport, worldToScreen } from '@mfd/cad-engine';
import { type Catalog, footprintCorners } from '@mfd/object-library';

import { ghostCentre } from './ghostCentre';
import { movedArrowTail } from './movedArrowTail';

interface ProposalGhostLayerProps {
  readonly diff: readonly PlacementDiffEntry[];
  readonly catalog: Catalog;
  readonly viewport: Viewport;
}

/**
 * The previewed layout, drawn as ghosts.
 *
 * ## Why a preview is part of the approval requirement rather than decoration
 *
 * The owner's fourth requirement is that an engineer approves explicitly before a layout is
 * applied. An approval given against a table of numbers is a weaker thing than one given against
 * the drawing: a total of 0.71 says nothing about whether the machines end up in front of the door.
 *
 * So the previewed proposal is drawn where it would go, and **only drawn** — nothing here writes to
 * the document. Dashed and half-transparent, so it cannot be mistaken for what is actually placed:
 * an engineer glancing at the canvas has to be able to tell a proposal from a decision.
 *
 * ## Three colours, because "where they would go" is not the question
 *
 * Owner requirement 5. On a twelve-station room where an optimisation moves two, twelve identical
 * ghosts leave an engineer to find the two by eye — and approving a change you have not located is
 * not much of an approval. So each ghost is drawn as what it *is*: green for a machine being added,
 * amber for one being moved, and a faint grey outline for one staying exactly where it is.
 *
 * A moved machine also gets a line back to where it came from. The colour says *that* it moves; the
 * line says *from where*, which is the half of the question a legend cannot answer.
 */

/**
 * One colour per change, and none of them is the palette's ordinary equipment colour.
 *
 * `unchanged` is deliberately the quietest: it is the category an engineer does not need to look
 * at, and drawing it as loudly as the others would bury the two ghosts that matter in ten that do
 * not. It is drawn at all so the proposal reads as a whole layout rather than as two loose machines.
 */
const CHANGE_STYLES: Readonly<
  Record<PlacementChange, { stroke: string; fill: string; label: string }>
> = {
  added: { stroke: '#34d399', fill: 'rgba(52, 211, 153, 0.14)', label: '#047857' },
  moved: { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.14)', label: '#b45309' },
  unchanged: { stroke: '#94a3b8', fill: 'rgba(148, 163, 184, 0.06)', label: '#64748b' },
};

export function ProposalGhostLayer({ diff, catalog, viewport }: ProposalGhostLayerProps) {
  return (
    <>
      {diff.map((entry, index) => {
        const object = catalog.get(entry.placement.equipmentObjectId);
        if (!object) return null;

        const style = CHANGE_STYLES[entry.change];
        const corners = footprintCorners(object, entry.placement.transform).map((corner) =>
          worldToScreen(viewport, corner),
        );
        /*
         * Known test gap (seventh Critical 0 review round): `ghostCentre` itself is unit-tested
         * (`ghostCentre.test.ts`) without a Konva canvas, but nothing exercises this call site —
         * reverting the line below to `entry.placement.transform.position` passes the whole suite.
         * No Konva-rendered component in this codebase is covered past its own pure functions today;
         * closing this needs an e2e assertion on the ghost's actual rendered geometry, not a unit
         * test, and is a follow-up rather than something this round invents new test tooling for.
         */
        const centreModel = ghostCentre(entry.placement, catalog);
        if (!centreModel) return null;
        const centre = worldToScreen(viewport, centreModel);
        const sourceCentreModel = movedArrowTail(entry.source, catalog);
        const sourceCentre = sourceCentreModel ? worldToScreen(viewport, sourceCentreModel) : null;

        return (
          <Fragment key={entry.placement.id}>
            {entry.change === 'moved' && entry.source && sourceCentre && (
              <Line
                points={[...vec(sourceCentre), ...vec(centre)]}
                stroke={style.stroke}
                strokeWidth={1}
                dash={[2, 3]}
                opacity={0.7}
                listening={false}
                perfectDrawEnabled={false}
              />
            )}
            <Line
              points={corners.flatMap((corner) => [corner.x, corner.y])}
              closed
              stroke={style.stroke}
              strokeWidth={entry.change === 'unchanged' ? 1 : 1.5}
              dash={[6, 4]}
              fill={style.fill}
              listening={false}
              perfectDrawEnabled={false}
            />
            {/*
              Numbered in proposal order, so the panel's breakdown and the drawing refer to the
              same machine — the same reason the report numbers its placements.
            */}
            <Text
              x={centre.x - 4}
              y={centre.y - 6}
              text={String(index + 1)}
              fontSize={12}
              fontStyle="bold"
              fill={style.label}
              listening={false}
              perfectDrawEnabled={false}
            />
          </Fragment>
        );
      })}
    </>
  );
}

function vec(point: { x: number; y: number }): [number, number] {
  return [point.x, point.y];
}
