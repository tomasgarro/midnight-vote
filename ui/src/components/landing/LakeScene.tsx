import { type RefObject, useEffect, useRef, useState } from 'react';

type SceneFiles = { av1: string; h264: string; start: string; end: string };

const BASE = '/art/civic/lake';
/**
 * `loop` turns on when the scene is a seamless loop (lake v2). The current clip plays once and
 * rests on its last frame, so that the boat never jumps back to the start.
 */
export const LAKE = {
  loop: false,
  desktop: {
    av1: `${BASE}/desktop.av1.mp4`,
    h264: `${BASE}/desktop.h264.mp4`,
    start: `${BASE}/desktop-start.webp`,
    end: `${BASE}/desktop-end.webp`,
  },
  phone: {
    av1: `${BASE}/phone.av1.mp4`,
    h264: `${BASE}/phone.h264.mp4`,
    start: `${BASE}/phone-start.webp`,
    end: `${BASE}/phone-end.webp`,
  },
} satisfies { loop: boolean; desktop: SceneFiles; phone: SceneFiles };

/** Reduced motion and data saver get the finished picture and never fetch the video. */
function prefersStill() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/**
 * The Geneva harbour from the Quai Wilson, engraved in sanguine. Nothing is fetched until the
 * scene is near. It plays when `trigger` (or the scene itself) comes into view.
 */
export function LakeScene({ trigger }: { trigger?: RefObject<HTMLElement | null> }) {
  const [files] = useState(() =>
    window.matchMedia('(max-width: 700px)').matches ? LAKE.phone : LAKE.desktop,
  );
  const [still, setStill] = useState(prefersStill);
  const [near, setNear] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setNear(true);
      },
      { rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = video.current;
    const scene = frame.current;
    const startOn = trigger?.current ?? scene;
    if (still || !near || !element || !scene || !startOn) return;
    let started = false;
    let sceneInView = true;
    const play = () => {
      element.play().catch(() => setStill(true));
    };
    // Start once a third of the scene shows: with a trigger (the edge of the panel above the
    // scene), when that edge has passed the top third of the window. A position check, not an
    // observer, so that a jump straight to the end of the page still counts.
    let frameRequest = 0;
    const check = () => {
      frameRequest = 0;
      if (started) return;
      const top = startOn.getBoundingClientRect().top;
      if (top >= window.innerHeight * (trigger ? 0.35 : 0.65)) return;
      started = true;
      window.removeEventListener('scroll', onScroll);
      play();
    };
    const onScroll = () => {
      if (!frameRequest) frameRequest = requestAnimationFrame(check);
    };
    check();
    if (!started) window.addEventListener('scroll', onScroll, { passive: true });
    // A loop rests while the scene is off screen; a single take is never restarted.
    const keeper = new IntersectionObserver((entries) => {
      sceneInView = entries.some((entry) => entry.isIntersecting);
      if (!LAKE.loop || !started) return;
      if (sceneInView) play();
      else element.pause();
    });
    keeper.observe(scene);
    const onVisibility = () => {
      if (document.hidden) element.pause();
      else if (started && !element.ended && sceneInView) play();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(frameRequest);
      window.removeEventListener('scroll', onScroll);
      keeper.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [still, near, trigger]);

  return (
    <div className="lake-scene" ref={frame} aria-hidden="true">
      {near &&
        (still ? (
          <img src={files.end} alt="" decoding="async" />
        ) : (
          <video
            ref={video}
            muted
            playsInline
            loop={LAKE.loop}
            preload="none"
            poster={files.start}
            disablePictureInPicture
          >
            <source src={files.av1} type='video/mp4; codecs="av01.0.08M.08"' />
            <source src={files.h264} type="video/mp4" />
          </video>
        ))}
    </div>
  );
}
