/**
 * When the Midnight Passport steps play, shared by the scroll timeline (PassportJourney.tsx) and
 * the 3D scene (passport-scene.ts), so the glass cards and the 3D objects move together.
 * Times are in screens of scrolling; beats are fractions of a step (0 as it arrives, 1 as it ends).
 * Each step plays its action in its first half and holds the finished state while you read.
 */
export const PARTS_AT = 3.0;
export const STEP = 0.8;
export const STEPS = 5;

export const BEATS = {
  /** 1. Money, identity and agents come out of the Midnight Passport, one after another. */
  home: { first: 0.12, gap: 0.085, length: 0.14 },
  /** 2. It opens on its data page; the app asks; the details are read; a proof answers. */
  ask: {
    open: [-0.08, 0.2],
    question: [0.12, 0.24],
    scan: [0.22, 0.4],
    fly: [0.4, 0.54],
    proven: [0.53, 0.6],
  },
  /** 3. The seed phrase is crossed out, the fingerprint unlocks, the sheet turns to the backup. */
  unlock: { cross: [0.1, 0.3], print: [0.16, 0.42], unlocked: 0.44, turn: [0.46, 0.62] },
  /** 4. The address decodes into a name, then what the name is for. */
  name: { decode: [0.1, 0.46], send: [0.48, 0.58] },
  /** 5. Each agent leaves with its own pass; the travel pass then shows what it did. */
  agents: { first: 0.08, gap: 0.085, length: 0.14, did: [0.5, 0.58] },
} as const;

/** The timeline time of a beat: step `k` (0 to 4), at fraction `at` of the step. */
export const beatAt = (k: number, at: number) => PARTS_AT + (k + at) * STEP;
