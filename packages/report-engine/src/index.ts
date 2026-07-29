/**
 * @mfd/report-engine — the installation review report.
 *
 * Scaffold only. Implemented in Sprint 5, where it produces the PDF defined in
 * section 5.5 of the TS Edition specification: project information, layout image,
 * equipment list, engineering check results and an installation checklist.
 *
 * The package exists now so the workspace is real rather than a directory holding a
 * README — `pnpm -r` skips a folder with no manifest, which makes an empty package
 * look like a wired-up one.
 *
 * Output will be vector, not a canvas screenshot. That is why the geometry lives in
 * `@mfd/cad-engine` and `@mfd/object-library` rather than inside the renderer
 * (architecture decision AD-2): this package will build the same drawing without a
 * browser.
 */

/** Placeholder so the package has a checkable surface before Sprint 5. */
export const REPORT_ENGINE_STATUS = 'scaffold' as const;
