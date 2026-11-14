import { useEffect, useState } from 'react';

type Gsap = typeof import('gsap').gsap;
type ScrollTriggerClass = typeof import('gsap/ScrollTrigger').ScrollTrigger;

let loading: Promise<{ gsap: Gsap; ScrollTrigger: ScrollTriggerClass }> | null = null;

/** GSAP arrives after the first paint, and only on screens that play the scroll scenes. */
export function loadScroll() {
  loading ??= Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(
    ([{ gsap }, { ScrollTrigger }]) => {
      gsap.registerPlugin(ScrollTrigger);
      return { gsap, ScrollTrigger };
    },
  );
  return loading;
}

/**
 * The pinned scenes need a little room and consent to move: phones and narrow windows play them
 * too. Very short windows and reduced motion get the same content laid out as a normal page.
 */
export const SCROLL_SCENES =
  '(min-width: 360px) and (min-height: 560px) and (prefers-reduced-motion: no-preference)';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [query]);
  return matches;
}
