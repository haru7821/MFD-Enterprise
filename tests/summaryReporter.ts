import type { FullResult, Reporter } from '@playwright/test/reporter';

/**
 * Browser CI output: **PASS or FAIL, and the execution time.** Nothing else.
 *
 * Owner decision. The previous CI reporters printed sixty-five lines of green ticks,
 * which is noise a reader has to scroll past to find the one fact they came for. This
 * prints two lines.
 *
 * ## Where the failure detail went
 *
 * Not deleted — moved. A gate that says only "FAIL" is a gate nobody can act on, so the
 * `html` reporter still runs on CI and `browser.yml` uploads `playwright-report/` as an
 * artifact whenever the job fails. The report carries the failing spec, its error, its
 * screenshot and the retry trace. So the *log* is two lines and the *diagnosis* is one
 * download, which is the split the decision asks for.
 *
 * (Worth recording: before this change the workflow uploaded `playwright-report/` without
 * any reporter configured to write it. The artifact step found nothing and said so in a
 * warning nobody reads. Making the log terse is what forced that to be noticed.)
 *
 * ## Why the exit code is not this file's business
 *
 * Playwright decides the process exit code from the run result, not from the reporter, so
 * a reporter that prints "FAIL" cannot accidentally let a red run pass. This class only
 * writes text.
 */
export default class SummaryReporter implements Reporter {
  private startedAt = 0;

  onBegin(): void {
    // Wall clock, taken here rather than derived from per-test durations: the run is
    // parallel, so the sum of test durations is not the time anyone waited.
    this.startedAt = Date.now();
  }

  onEnd(result: FullResult): void {
    const seconds = ((Date.now() - this.startedAt) / 1_000).toFixed(1);
    // 'passed' is the only status that is a pass. 'failed', 'timedout' and
    // 'interrupted' are all FAIL — an interrupted run has not demonstrated anything,
    // and reporting it as anything other than a failure would be reporting a hope.
    const verdict = result.status === 'passed' ? 'PASS' : 'FAIL';

    process.stdout.write(`\nBrowser CI: ${verdict}\nExecution time: ${seconds} s\n`);
  }

  /** Terse output only makes sense if nothing else is also printing. */
  printsToStdio(): boolean {
    return true;
  }
}
