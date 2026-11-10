/**
 * The hero's pictures, and where the Midnight symbol sits on the passport cover.
 *
 * Every position is a fraction of the hand frame: the part of the artwork the stage shows.
 * When the Blender render arrives, only this file changes: switch `hands` to `stacked-video`,
 * set `symbol.baked` and measure the symbol on the render's rest frame.
 */
type Box = { x: number; y: number; width: number; height: number };

export type HandSource =
  | {
      kind: 'stills';
      human: string;
      agent: string;
      /** The pictures' full size, and the part of them the frame shows. */
      size: { width: number; height: number };
      crop: Box;
    }
  | {
      kind: 'stacked-video';
      /** One video: the human hand in the top half, the robot hand in the bottom half. */
      av1?: string;
      h264: string;
      /** The rest frame (frame 0) of the human half: the poster, and what reduced motion sees. */
      poster: string;
    };

export type HeroAssets = {
  /** The hand frame, in pixels of the source artwork. */
  frame: { width: number; height: number };
  hands: HandSource;
  /**
   * The symbol on the cover at rest: its centre, its width (fractions of the frame width) and the
   * rotation and shear that lay the flat symbol onto the cover. `baked` is true when the render
   * already shows the symbol, so the drawn one only appears for the zoom.
   */
  symbol: { x: number; y: number; size: number; rotate: number; skewX: number; baked: boolean };
  /** From the symbol's centre to the nearest edge of the cover, as fractions of the frame. */
  coverReach: { x: number; y: number };
  /** Where the palm is: the reveal also opens near it. */
  palm: { x: number; y: number };
  sky: string;
  columns: string;
};

export const HERO_ASSETS: HeroAssets = {
  frame: { width: 742, height: 891 },
  hands: {
    kind: 'stills',
    human: '/art/passport/human-hand.webp',
    agent: '/art/passport/agent-hand.webp',
    size: { width: 1672, height: 941 },
    crop: { x: 930, y: 50, width: 742, height: 891 },
  },
  symbol: { x: 0.3585, y: 0.3311, size: 0.1698, rotate: -10.95, skewX: -1.75, baked: false },
  coverReach: { x: 0.22, y: 0.21 },
  palm: { x: 0.5, y: 0.7 },
  sky: '/art/civic/alpine-lake.webp',
  columns: '/art/civic/portico.webp',
};
