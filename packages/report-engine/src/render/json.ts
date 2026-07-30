import type { ReportModel } from '../model';

/**
 * The JSON renderer.
 *
 * Three lines, and that is the point rather than an accident. A format can only be this
 * cheap if the model already holds every decision the report makes — the verdict, which
 * findings are provisional, which figures are cited, what order the sections go in. The
 * moment a renderer needed to work something out, JSON would stop being possible and the
 * boundary the owner asked for would have leaked.
 *
 * So this file is the test of the architecture as much as it is a feature. It is also
 * genuinely useful: a stored `ReportModel` is what a future revision comparison would diff,
 * and what a server would hand back for a browser to check its own output against.
 *
 * Pretty-printed, because a JSON report is read by people at least as often as by programs.
 */
export function renderJson(model: ReportModel): string {
  return JSON.stringify(model, null, 2);
}
