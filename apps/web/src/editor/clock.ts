/**
 * The one place the editor reads a clock.
 *
 * Undo coalescing depends on when a command was issued, and the document records when
 * it was saved. Neither may be read inside the reducer: React invokes reducers twice
 * in development, and a reducer that produced a different result each time would make
 * a drag merge into one undo step on the first run and two on the second.
 *
 * So the timestamp is taken here, at the call site, and travels in the action.
 */

/** Milliseconds since the epoch, for undo coalescing. */
export function now(): number {
  return Date.now();
}

/** ISO 8601, for timestamps stored in the document. */
export function timestamp(): string {
  return new Date().toISOString();
}
