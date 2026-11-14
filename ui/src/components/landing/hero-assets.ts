/**
 * The hero's pictures, and where the Midnight symbol sits on the passport cover.
 *
 * Every position is a fraction of the hand frame: the part of the artwork the stage shows.
 * The numbers come from the hero hand build (`hero-assets.json`): the symbol is measured on the
 * loop's rest frame.
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
      kind: 'packed-video';
      /**
       * One video, a 2 x 2 grid: human colour | human alpha over agent colour | agent alpha.
       * Colour is premultiplied on black, alpha is greyscale.
       */
      av1?: string;
      h264: string;
      /** The rest frame (frame 0) of the human hand: the poster, and what reduced motion sees. */
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
  frame: { width: 1200, height: 1800 },
  hands: {
    kind: 'packed-video',
    av1: '/art/passport/hands-2x2.av1.mp4',
    h264: '/art/passport/hands-2x2.h264.mp4',
    poster: '/art/passport/human-poster.webp',
  },
  symbol: { x: 0.5008, y: 0.2318, size: 0.1756, rotate: -0.22, skewX: -0.26, baked: true },
  coverReach: { x: 0.3267, y: 0.2268 },
  palm: { x: 0.44, y: 0.69 },
  sky: '/art/civic/alpine-lake.webp',
  columns: '/art/civic/portico.webp',
};
