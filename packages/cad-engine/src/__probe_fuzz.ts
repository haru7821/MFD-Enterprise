import { polygonsOverlapAnywhere, polygonArea, type Polygon } from './polygon';

// Reference: sample-based interior-overlap area on a fine grid, with an inward margin.
function refOverlapArea(a: Polygon, b: Polygon, step = 0.25): number {
  const xs = [...a, ...b].map((p) => p.x); const ys = [...a, ...b].map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let count = 0, cells = 0;
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let y = y0 + step / 2; y < y1; y += step) {
      cells += 1;
      if (strictIn(a, { x, y }) && strictIn(b, { x, y })) count += 1;
    }
  }
  void cells;
  return count * step * step;
}
function strictIn(poly: Polygon, p: { x: number; y: number }): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!, b = poly[i]!;
    if ((a.y > p.y) !== (b.y > p.y)) {
      const cx = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (p.x < cx) inside = !inside;
    }
  }
  return inside;
}
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Random simple polygons: star-shaped about a centre (always simple), integer-ish coords on a lattice
function randPoly(r: () => number, cx: number, cy: number, n: number, maxR: number): Polygon {
  const angles: number[] = [];
  for (let i = 0; i < n; i += 1) angles.push(r() * Math.PI * 2);
  angles.sort((a, b) => a - b);
  return angles.map((t) => {
    const rad = 1 + Math.floor(r() * maxR);
    return { x: Math.round(cx + rad * Math.cos(t)), y: Math.round(cy + rad * Math.sin(t)) };
  });
}
function ok(p: Polygon): boolean {
  if (polygonArea(p) < 4) return false;
  for (let i = 0; i < p.length; i += 1) for (let j = i + 1; j < p.length; j += 1) {
    if (p[i]!.x === p[j]!.x && p[i]!.y === p[j]!.y) return false;
  }
  return true;
}

const r = rng(20260801);
let checked = 0, falseNeg = 0, falsePos = 0;
const samples: string[] = [];
for (let iter = 0; iter < 40000; iter += 1) {
  const a = randPoly(r, 0, 0, 3 + Math.floor(r() * 4), 8);
  const b = randPoly(r, Math.round(r() * 16 - 8), Math.round(r() * 16 - 8), 3 + Math.floor(r() * 4), 8);
  if (!ok(a) || !ok(b)) continue;
  checked += 1;
  const said = polygonsOverlapAnywhere(a, b);
  const area = refOverlapArea(a, b);
  if (!said && area > 1.0) { falseNeg += 1; if (samples.length < 6) samples.push(`FALSE-NEG area=${area.toFixed(2)} A=${JSON.stringify(a)} B=${JSON.stringify(b)}`); }
  if (said && area === 0) { falsePos += 1; if (samples.length < 12) samples.push(`FALSE-POS A=${JSON.stringify(a)} B=${JSON.stringify(b)}`); }
}
console.log({ checked, falseNeg, falsePos });
for (const s of samples) console.log(s);
