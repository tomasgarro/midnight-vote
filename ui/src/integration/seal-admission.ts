/**
 * Seals an answer, waiting first if the pass is not admitted yet.
 *
 * A person who has just received a pass can answer a consultation only once
 * the credential service has published a root that holds the pass to it. That
 * takes a minute or two. Sending the person back to tap again would make them
 * do the app's waiting, so the app asks again by itself until the pass is
 * admitted or the wait has been long enough to mean something is wrong.
 *
 * Nothing is sent and nothing is stored while it waits: the refusal comes
 * before the proof is built and before the answer's opening is written.
 */
export interface SealWhenAdmittedOptions<T> {
  /** Seals the answer once. Refuses with `CREDENTIAL_NOT_ADMITTED` while the pass is not admitted. */
  readonly seal: () => Promise<T>;
  /** Told `true` when the wait begins and `false` when it ends, however it ends. */
  readonly onWaiting?: (waiting: boolean) => void;
  /** How long to keep asking before giving the refusal back. */
  readonly waitMs?: number;
  /** The pause between two attempts. */
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export const ADMISSION_WAIT_MS = 180_000;
export const ADMISSION_RETRY_MS = 8_000;

function isNotAdmittedYet(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === 'CREDENTIAL_NOT_ADMITTED';
}

export async function sealWhenAdmitted<T>(options: SealWhenAdmittedOptions<T>): Promise<T> {
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const waitMs = options.waitMs ?? ADMISSION_WAIT_MS;
  const intervalMs = options.intervalMs ?? ADMISSION_RETRY_MS;
  const startedAt = now();
  let waiting = false;
  try {
    for (;;) {
      try {
        return await options.seal();
      } catch (error) {
        // Any other refusal is final. So is this one, once the wait is spent.
        if (!isNotAdmittedYet(error) || now() - startedAt + intervalMs > waitMs) throw error;
        if (!waiting) {
          waiting = true;
          options.onWaiting?.(true);
        }
        await sleep(intervalMs);
      }
    }
  } finally {
    if (waiting) options.onWaiting?.(false);
  }
}
