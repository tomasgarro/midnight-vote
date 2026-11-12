/**
 * The official Midnight symbol, redrawn from `public/brand/midnight-symbol-white.svg` with the
 * same geometry, so that its ring and each of its three squares can move on their own.
 * The squares are numbered from the top. It takes the text colour.
 */
export function MidnightMark({
  className,
  title,
  traced = false,
}: {
  className?: string;
  title?: string;
  /** Also draw the ring as one stroke, so it can be traced on (the same annulus: 321.91 to 394.69). */
  traced?: boolean;
}) {
  return (
    <svg
      className={className ? `midnight-mark ${className}` : 'midnight-mark'}
      viewBox="0 0 789.37 789.37"
      overflow="visible"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path
        className="midnight-mark__ring"
        fill="currentColor"
        fillRule="evenodd"
        d="m394.69,0C176.71,0,0,176.71,0,394.69s176.71,394.69,394.69,394.69,394.69-176.71,394.69-394.69S612.67,0,394.69,0Zm0,716.6c-177.5,0-321.91-144.41-321.91-321.91S217.18,72.78,394.69,72.78s321.91,144.41,321.91,321.91-144.41,321.91-321.91,321.91Z"
      />
      {traced && (
        <circle
          className="midnight-mark__trace"
          cx="394.685"
          cy="394.685"
          r="358.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="72.78"
          pathLength={1}
          transform="rotate(-90 394.685 394.685)"
        />
      )}
      <rect
        className="midnight-mark__square midnight-mark__square--1"
        fill="currentColor"
        x="357.64"
        y="123.69"
        width="74.09"
        height="74.09"
      />
      <rect
        className="midnight-mark__square midnight-mark__square--2"
        fill="currentColor"
        x="357.64"
        y="240.66"
        width="74.09"
        height="74.09"
      />
      <rect
        className="midnight-mark__square midnight-mark__square--3"
        fill="currentColor"
        x="357.64"
        y="357.64"
        width="74.09"
        height="74.09"
      />
    </svg>
  );
}

/** Square centres in the symbol's own units, from the top. */
export const MARK_UNITS = 789.37;
export const SQUARE_CENTRES_Y = [160.735, 277.705, 394.685] as const;
