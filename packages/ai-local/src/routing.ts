import type { Vec2 } from '@mfd/cad-engine';

/**
 * Routed distance from a reference point to a machine.
 *
 * ## Why not a straight line
 *
 * Pipe, cable and people go **around** things. A straight-line distance from a panel to a machine
 * on the far side of a column is a number that looks like engineering and is not, and it would
 * rank a layout by a run nobody could install. Three criteria and 20 % of the approved model rest
 * on this figure, so it has to mean something.
 *
 * ## Why not a full router either
 *
 * A true routing solver — real pipe sizes, bend radii, tray segregation, ceiling voids — is a
 * product in its own right and not what a *ranking* needs. What ranking needs is a number that
 * orders two layouts the same way a real route would, and an orthogonal path around obstructions
 * does that.
 *
 * So: **Manhattan, with obstruction avoidance, on a lattice.** Two L-shaped routes are tried
 * first because they are the answer in an unobstructed room and cost nothing; if both are blocked
 * a breadth-first search over a coarse grid finds a way round. If the search finds nothing, the
 * answer is `null` — *no route* — and the criterion reports **unavailable** rather than a
 * fabricated distance (AD-18).
 *
 * The lattice is coarse on purpose. A fine grid would give a marginally shorter path and take a
 * hundred times as long, and the extra precision would be spurious: the input is a traced plan and
 * the reference point is where an engineer clicked.
 */

/** Lattice pitch. 250 mm resolves a doorway without making the search expensive. */
const CELL = 250;

/** Bounded so a pathological room cannot hang the solver. 200 × 200 cells is a 50 m square. */
const MAX_CELLS_PER_AXIS = 200;

export interface RouteInput {
  readonly from: Vec2;
  readonly to: Vec2;
  /** Rectangles the route may not pass through, as axis-aligned bounds. */
  readonly blocked: readonly Bounds[];
  /** The area to search within — the room, expanded a little so a route may hug a wall. */
  readonly within: Bounds;
}

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function boundsOf(polygon: readonly Vec2[]): Bounds | null {
  if (polygon.length === 0) return null;
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

export function boundsAround(centre: Vec2, width: number, depth: number): Bounds {
  return {
    minX: centre.x - width / 2,
    minY: centre.y - depth / 2,
    maxX: centre.x + width / 2,
    maxY: centre.y + depth / 2,
  };
}

function contains(bounds: Bounds, point: Vec2): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/**
 * Routed length in millimetres, or **null when no route exists**.
 *
 * Null is a real answer and callers must not coerce it to a number. For a criterion that
 * *minimises*, substituting zero would make an unroutable layout the best possible one.
 */
export function routedDistance(input: RouteInput): number | null {
  const direct = shortestClearL(input);
  if (direct !== null) return direct;
  return searchAround(input);
}

/** The two L-shaped Manhattan routes. Returns the shorter clear one, or null if both are blocked. */
function shortestClearL(input: RouteInput): number | null {
  const corner1 = { x: input.to.x, y: input.from.y };
  const corner2 = { x: input.from.x, y: input.to.y };

  for (const corner of [corner1, corner2]) {
    if (
      segmentClear(input.from, corner, input.blocked) &&
      segmentClear(corner, input.to, input.blocked)
    ) {
      // Both L routes have identical Manhattan length, so the first clear one is as short as any.
      return manhattan(input.from, input.to);
    }
  }
  return null;
}

export function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Does an axis-aligned segment cross any blocked rectangle?
 *
 * Sampled rather than solved analytically. Sampling at half a cell cannot miss a rectangle wider
 * than a cell, and every blocker here is a machine footprint or a column — all far larger than
 * 125 mm. An analytic segment-rectangle test would be exact and would be exact about geometry that
 * is already approximate.
 */
function segmentClear(a: Vec2, b: Vec2, blocked: readonly Bounds[]): boolean {
  if (blocked.length === 0) return true;

  const length = manhattan(a, b);
  const steps = Math.max(1, Math.ceil(length / (CELL / 2)));

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (blocked.some((rect) => contains(rect, point))) return false;
  }
  return true;
}

/**
 * Breadth-first search over a lattice, four-connected.
 *
 * BFS rather than A*: on a uniform grid with unit costs BFS is already optimal, and A*'s heuristic
 * would buy speed at the cost of a priority queue whose tie-breaking would have to be made
 * deterministic by hand. Neighbours are visited in a fixed order, so the path found is the same on
 * every run.
 */
function searchAround(input: RouteInput): number | null {
  const columns = Math.min(
    MAX_CELLS_PER_AXIS,
    Math.max(1, Math.ceil((input.within.maxX - input.within.minX) / CELL)),
  );
  const rows = Math.min(
    MAX_CELLS_PER_AXIS,
    Math.max(1, Math.ceil((input.within.maxY - input.within.minY) / CELL)),
  );

  const cellOf = (point: Vec2) => ({
    column: clamp(Math.floor((point.x - input.within.minX) / CELL), 0, columns - 1),
    row: clamp(Math.floor((point.y - input.within.minY) / CELL), 0, rows - 1),
  });
  const centreOf = (column: number, row: number): Vec2 => ({
    x: input.within.minX + (column + 0.5) * CELL,
    y: input.within.minY + (row + 0.5) * CELL,
  });

  const start = cellOf(input.from);
  const goal = cellOf(input.to);
  const passable = (column: number, row: number) =>
    !input.blocked.some((rect) => contains(rect, centreOf(column, row)));

  /*
   * Two cells are exempt from `passable`, and both deliberately.
   *
   * The **goal** is inside the machine's own footprint, so it is blocked by construction; reaching
   * its cell is the success condition rather than standing on it. The **start** may be blocked too
   * — a reference point an engineer placed a few centimetres inside a machine — and refusing to
   * route from it would report `unavailable` for a layout whose only fault is where somebody
   * clicked.
   */
  const seen = new Uint8Array(columns * rows);
  const index = (column: number, row: number) => row * columns + column;
  let frontier: { column: number; row: number }[] = [start];
  seen[index(start.column, start.row)] = 1;
  let steps = 0;

  // Fixed neighbour order: east, south, west, north. Any order works; a *stable* one is required.
  const NEIGHBOURS = [
    { dc: 1, dr: 0 },
    { dc: 0, dr: 1 },
    { dc: -1, dr: 0 },
    { dc: 0, dr: -1 },
  ];

  while (frontier.length > 0) {
    if (frontier.some((cell) => cell.column === goal.column && cell.row === goal.row)) {
      return steps * CELL;
    }

    const next: { column: number; row: number }[] = [];
    for (const cell of frontier) {
      for (const { dc, dr } of NEIGHBOURS) {
        const column = cell.column + dc;
        const row = cell.row + dr;
        if (column < 0 || row < 0 || column >= columns || row >= rows) continue;
        if (seen[index(column, row)] === 1) continue;

        const isGoal = column === goal.column && row === goal.row;
        if (!isGoal && !passable(column, row)) continue;

        seen[index(column, row)] = 1;
        next.push({ column, row });
      }
    }
    frontier = next;
    steps += 1;
  }

  return null;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
