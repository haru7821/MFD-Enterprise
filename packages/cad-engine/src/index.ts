/**
 * @mfd/cad-engine — the geometry core of MFD-E.
 *
 * Pure TypeScript. No React, no Konva, no NestJS, no Node built-ins, no DOM.
 * Anything imported here must run unchanged in a browser tab, a server process and
 * a test runner — that constraint is what keeps the domain independent of whatever
 * renders it (CLAUDE.md: "Every module must be independent").
 */

export * from './units';
export * from './vec2';
export * from './rect';
export * from './viewport';
export * from './grid';
