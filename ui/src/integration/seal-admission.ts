/**
 * Seals an answer, waiting first if the pass is not admitted yet.
 *
 * A person who has just received a pass can answer a consultation only once
 * the credential service has published a root that holds the pass to it. That
 * takes a minute or two. Sending the person back to tap again would make them
 * do the app's waiting, so the app asks by itself until the pass is admitted
 * or the wait has been long enough to mean something is wrong.
 *
 * The question is asked before any proof is built, so nothing is sent and
 * nothing is stored while it waits. The wait ends when the pass is admitted,
 * not when the answer is sealed: the screen then shows the proof being built.
 */
export type PassAdmission = 'admitted' | 'pending' | 'closed' | 'no-pass';

export interface SealWhenAdmittedOptions<T> {
  /** Seals the answer once. It refuses by itself whatever `admission` did not settle. */
  readonly seal: () => Promise<T>;
  /**
   * Asks, without building a proof, where the pass stands. Absent when the
   * adapter cannot ask: the answer is then sealed at once.
   */
  readonly admission?: () => Promise<PassAdmission>;
  /** Told `true` when the wait begins and `false` when it ends, however it ends. */
  readonly onWaiting?: (waiting: boolean) => void;
  /** How long to keep asking before letting `seal` give the refusal. */
  readonly waitMs?: number;
  /** The pause between two questions. */
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export const ADMISSION_WAIT_MS = 180_000;
export const ADMISSION_RETRY_MS = 8_000;

export async function sealWhenAdmitted<T>(options: SealWhenAdmittedOptions<T>): Promise<T> {
  const { admission } = options;
  if (admission) {
    const now = options.now ?? (() => Date.now());
    const sleep =
      options.sleep ??
      ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    const waitMs = options.waitMs ?? ADMISSION_WAIT_MS;
    const intervalMs = options.intervalMs ?? ADMISSION_RETRY_MS;
    const startedAt = now();
    let waiting = false;
    try {
      // Only `pending` is worth waiting for. Every other standing, and a wait
      // that is spent, goes to `seal`, which says what is wrong in its own words.
      while ((await admission()) === 'pending' && now() - startedAt + intervalMs <= waitMs) {
        if (!waiting) {
          waiting = true;
          options.onWaiting?.(true);
        }
        await sleep(intervalMs);
      }
    } finally {
      if (waiting) options.onWaiting?.(false);
    }
  }
  return options.seal();
}
