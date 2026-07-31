import { useRef, useState } from 'react';

import { formatLength } from '@mfd/cad-engine';

import { timestamp } from '@/editor/clock';
import { activeLevel, planStatusOf } from '@/editor/editorState';
import { useEditor } from '@/editor/useEditor';
import {
  calibrateFromStatedRatio,
  calibrateFromTwoPoints,
  recommendCalibration,
  type CalibrationAdviceCode,
} from '@mfd/document-model';

import { PlanImportError, importPlanFile } from './planImport';

/**
 * The plan workflow, as four visible steps.
 *
 * | | Step | Produces |
 * | --- | --- | --- |
 * | 1 | Import the drawing | the image |
 * | 2 | Set the scale | millimetres per pixel |
 * | 3 | Set the origin | where model (0, 0) sits |
 * | 4 | Square the drawing | rotation |
 *
 * **Step 2 has no skip button.** Until it is done the level is uncalibrated and every
 * rule reports YELLOW rather than GREEN. Measuring a screen distance and calling it a
 * clearance is the single most damaging thing this application could do, so it is
 * blocked structurally rather than by a warning somebody can dismiss.
 *
 * Steps 3 and 4 default to the top-left pixel and no rotation, which are honest
 * defaults — a plan measured from its own corner is still correctly measured.
 */

function Step({
  index,
  title,
  done,
  children,
}: {
  readonly index: number;
  readonly title: string;
  readonly done: boolean;
  readonly children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-2.5">
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
          done ? 'bg-accent text-canvas' : 'border border-edge text-ink-faint'
        }`}
        aria-hidden="true"
      >
        {done ? '✓' : index}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[11px] font-medium ${done ? 'text-ink-muted' : 'text-ink'}`}>
          {title}
        </div>
        {children}
      </div>
    </li>
  );
}

/**
 * What the recommendation means, in words an engineer can act on.
 *
 * Typed as a total record over the advice codes, so adding a code to the document model without
 * writing its sentence is a compile error rather than a blank line in the panel.
 */
const CALIBRATION_ADVICE_TEXT: Readonly<Record<CalibrationAdviceCode, string>> = {
  prefer_two_point:
    'Measure the printed dimension. It measures the drawing as it is, including any rescaling on printing or scanning.',
  fallback_stated_ratio:
    'No dimension to measure, but this drawing was rendered at a known resolution, so its printed scale can be converted. Weaker: it assumes the sheet was neither rescaled on printing nor cropped on scanning.',
  no_method_available:
    'Neither method can be completed for this drawing.',
  awaiting_dimension_line_answer:
    'Answer above and the stronger method will be offered first.',
  no_plan_image: 'Import a drawing first.',
};

export function PlanPanel() {
  const { state, dispatch } = useEditor();
  const level = activeLevel(state);
  const status = planStatusOf(level);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [distance, setDistance] = useState('');
  const [ratio, setRatio] = useState('');
  /**
   * Whether this drawing carries a printed dimension, as the engineer reports it.
   *
   * Session state rather than document state, and null until they answer. The application cannot
   * work this out — a PDF's vector content is never read — so it asks, and `null` stays distinct
   * from `false` because "nobody has looked" and "there is none" lead to different advice.
   */
  const [hasDimensionLine, setHasDimensionLine] = useState<boolean | null>(null);

  const picked = state.pick?.kind === 'calibrate' ? state.pick.points : [];
  const readyToCalibrate = picked.length === 2;
  const advice = recommendCalibration({
    planImage: level.planImage,
    hasDimensionLine,
  });

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const planImage = await importPlanFile(file, { now: timestamp() });
      dispatch({ type: 'plan/import', planImage });
    } catch (cause) {
      setError(
        cause instanceof PlanImportError ? cause.message : `Could not import ${file.name}`,
      );
    } finally {
      setBusy(false);
      // Clear the input so re-picking the same file fires a change event again.
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function commitCalibration() {
    const pointA = picked[0];
    const pointB = picked[1];
    const knownDistance = Number(distance);
    if (!pointA || !pointB) return;

    const mapping = calibrateFromTwoPoints({
      pointA,
      pointB,
      knownDistance,
      now: timestamp(),
      // Keep the origin and rotation the engineer already set, if any.
      origin: level.coordinateMapping?.origin ?? { x: 0, y: 0 },
      rotation: level.coordinateMapping?.rotation ?? 0,
    });

    if (!mapping) {
      // Refusing is deliberate: a level that looks calibrated but measures nonsense
      // is strictly worse than one that is honestly uncalibrated.
      setError('Those two points and that distance do not give a usable scale.');
      return;
    }

    setError(null);
    setDistance('');
    dispatch({ type: 'plan/setMapping', mapping });
  }

  /**
   * The fallback route — Owner decision, Q-4.
   *
   * Only reachable when `renderDpi` is known, because the conversion needs it. The panel does not
   * offer this button otherwise: a route that could only fail at the last step is worse than one
   * that is honestly absent.
   */
  function commitStatedRatio() {
    const dotsPerInch = level.planImage?.renderDpi;
    if (dotsPerInch == null) return;

    const mapping = calibrateFromStatedRatio({
      statedRatio: ratio,
      dotsPerInch,
      now: timestamp(),
      origin: level.coordinateMapping?.origin ?? { x: 0, y: 0 },
      rotation: level.coordinateMapping?.rotation ?? 0,
    });

    if (!mapping) {
      setError(`"${ratio}" is not a scale this can read. Try a form like 1:100.`);
      return;
    }

    setError(null);
    setRatio('');
    dispatch({ type: 'plan/setMapping', mapping });
  }

  return (
    <section className="border-b border-edge px-3 py-2.5" aria-label="Floor plan">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Floor plan
        </h2>
        {level.planImage && (
          <button
            type="button"
            className="text-[10px] text-ink-faint underline-offset-2 hover:text-ink-muted hover:underline"
            onClick={() => dispatch({ type: 'plan/toggle' })}
          >
            {state.showPlan ? 'hide' : 'show'}
          </button>
        )}
      </div>

      <ol className="flex flex-col gap-2.5">
        <Step index={1} title="Import a drawing" done={level.planImage !== null}>
          {level.planImage ? (
            <p className="truncate font-mono text-[10px] text-ink-faint" title={level.planImage.sourceFileName}>
              {level.planImage.sourceFileName} · {level.planImage.pixelWidth}×
              {level.planImage.pixelHeight} px
            </p>
          ) : (
            <p className="text-[10px] text-ink-faint">PDF, PNG or JPG</p>
          )}

          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            className="sr-only"
            data-testid="plan-file-input"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
          <div className="mt-1 flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              data-testid="import-plan"
              className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-ink-muted hover:border-accent hover:text-ink disabled:opacity-50"
              onClick={() => fileRef.current?.click()}
            >
              {busy ? 'Importing…' : level.planImage ? 'Replace' : 'Import'}
            </button>
            {level.planImage && (
              <button
                type="button"
                className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-ink-faint hover:border-red-500/60 hover:text-red-300"
                onClick={() => dispatch({ type: 'plan/clear' })}
              >
                Remove
              </button>
            )}
          </div>
        </Step>

        <Step index={2} title="Set the scale" done={status === 'calibrated'}>
          {status !== 'none' && status !== 'calibrated' && state.pick?.kind !== 'calibrate' && (
            <div className="mb-1.5" data-testid="calibration-advice" data-code={advice.code}>
              <p className="text-[10px] text-ink-faint">
                Does this drawing show a dimension with its value printed on it?
              </p>
              <div className="mt-1 flex items-center gap-1">
                {([true, false] as const).map((answer) => (
                  <button
                    key={String(answer)}
                    type="button"
                    data-testid={`dimension-line-${answer ? 'yes' : 'no'}`}
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${
                      hasDimensionLine === answer
                        ? 'border-accent bg-accent/15 text-ink'
                        : 'border-edge text-ink-muted hover:border-accent hover:text-ink'
                    }`}
                    onClick={() => setHasDimensionLine(answer)}
                  >
                    {answer ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-ink-faint" data-testid="calibration-advice-text">
                {CALIBRATION_ADVICE_TEXT[advice.code]}
              </p>
            </div>
          )}
          {status === 'none' ? (
            <p className="text-[10px] text-ink-faint">Import a drawing first.</p>
          ) : state.pick?.kind === 'calibrate' ? (
            <div className="mt-1 flex flex-col gap-1.5">
              <p className="text-[10px] text-ink-faint">
                {picked.length === 0
                  ? 'Click the first end of a known distance on the drawing.'
                  : picked.length === 1
                    ? 'Click the other end.'
                    : 'Type the real distance between the two points.'}
              </p>
              {readyToCalibrate && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    placeholder="mm"
                    value={distance}
                    data-testid="calibration-distance"
                    className="w-20 rounded border border-edge bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-ink outline-none focus:border-accent"
                    onChange={(event) => setDistance(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitCalibration();
                    }}
                  />
                  <button
                    type="button"
                    data-testid="calibration-apply"
                    className="rounded border border-accent bg-accent/15 px-1.5 py-0.5 text-[10px] text-ink hover:bg-accent/25"
                    onClick={commitCalibration}
                  >
                    Apply
                  </button>
                </div>
              )}
              <button
                type="button"
                className="self-start text-[10px] text-ink-faint underline-offset-2 hover:text-ink-muted hover:underline"
                onClick={() => dispatch({ type: 'pick/cancel' })}
              >
                cancel
              </button>
            </div>
          ) : status === 'calibrated' ? (
            <div className="mt-0.5">
              <p className="font-mono text-[10px] text-ink-faint">
                {level.coordinateMapping?.millimetresPerPixel.toFixed(3)} mm/px ·{' '}
                {level.coordinateMapping?.calibration.method}
              </p>
              {level.coordinateMapping?.calibration.knownDistance != null && (
                <p className="font-mono text-[10px] text-ink-faint">
                  from {formatLength(level.coordinateMapping.calibration.knownDistance)}
                </p>
              )}
              <button
                type="button"
                data-testid="recalibrate"
                className="mt-1 rounded border border-edge px-1.5 py-0.5 text-[10px] text-ink-muted hover:border-accent hover:text-ink"
                onClick={() => dispatch({ type: 'calibration/start' })}
              >
                Recalibrate
              </button>
            </div>
          ) : (
            <div className="mt-1 flex flex-col gap-1.5">
              {advice.available.includes('two-point') && (
                <button
                  type="button"
                  data-testid="calibrate"
                  className={`self-start rounded border px-1.5 py-0.5 text-[10px] ${
                    advice.recommended === 'two-point'
                      ? 'border-amber-500/60 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                      : 'border-edge text-ink-muted hover:border-accent hover:text-ink'
                  }`}
                  onClick={() => dispatch({ type: 'calibration/start' })}
                >
                  Measure a dimension{advice.recommended === 'two-point' ? ' — recommended' : ''}
                </button>
              )}

              {advice.available.includes('stated-ratio') && (
                <div className="flex items-center gap-1.5" data-testid="stated-ratio-route">
                  <input
                    type="text"
                    placeholder="1:100"
                    value={ratio}
                    data-testid="stated-ratio-input"
                    className="w-20 rounded border border-edge bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-ink outline-none focus:border-accent"
                    onChange={(event) => setRatio(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitStatedRatio();
                    }}
                  />
                  <button
                    type="button"
                    data-testid="stated-ratio-apply"
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${
                      advice.recommended === 'stated-ratio'
                        ? 'border-amber-500/60 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                        : 'border-edge text-ink-muted hover:border-accent hover:text-ink'
                    }`}
                    onClick={commitStatedRatio}
                  >
                    Use printed scale
                  </button>
                </div>
              )}

              {advice.available.length === 0 && (
                <p
                  className="rounded border border-amber-500/50 bg-amber-500/10 px-1.5 py-1 text-[10px] text-amber-200"
                  data-testid="calibration-impossible"
                >
                  Calibration required, and neither method can be completed for this drawing. It was
                  imported as pixels, so its resolution is unknown and a printed scale cannot be
                  converted; and it carries no dimension to measure against. Every measurement on
                  this level stays unavailable until a drawing with one or the other is imported.
                </p>
              )}
            </div>
          )}
        </Step>

        <Step index={3} title="Set the origin" done={status === 'calibrated'}>
          {status !== 'calibrated' ? (
            <p className="text-[10px] text-ink-faint">
              Set the scale first — there is nothing to be the origin of until then.
            </p>
          ) : state.pick?.kind === 'origin' ? (
            <div className="mt-1 flex flex-col gap-1">
              <p className="text-[10px] text-ink-faint">
                Click the point on the drawing that is model (0, 0). The layout stays where
                it is; its coordinates are renumbered from there.
              </p>
              <button
                type="button"
                className="self-start text-[10px] text-ink-faint underline-offset-2 hover:text-ink-muted hover:underline"
                onClick={() => dispatch({ type: 'pick/cancel' })}
              >
                cancel
              </button>
            </div>
          ) : (
            <div className="mt-0.5">
              <p className="font-mono text-[10px] text-ink-faint">
                pixel {Math.round(level.coordinateMapping?.origin.x ?? 0)},{' '}
                {Math.round(level.coordinateMapping?.origin.y ?? 0)}
              </p>
              <button
                type="button"
                data-testid="set-origin"
                className="mt-1 rounded border border-edge px-1.5 py-0.5 text-[10px] text-ink-muted hover:border-accent hover:text-ink"
                onClick={() => dispatch({ type: 'origin/start' })}
              >
                Pick on drawing
              </button>
            </div>
          )}
        </Step>

        <Step index={4} title="Square the drawing" done={status === 'calibrated'}>
          <p className="text-[10px] text-ink-faint">
            {status === 'calibrated'
              ? `${((level.coordinateMapping?.rotation ?? 0) / 1000).toFixed(2)}° applied`
              : 'Defaults to no rotation.'}
          </p>
        </Step>
      </ol>

      {error && (
        <p
          data-testid="plan-error"
          className="mt-2 rounded border border-red-500/50 bg-red-500/10 px-1.5 py-1 text-[10px] text-red-200"
        >
          {error}
        </p>
      )}
    </section>
  );
}
