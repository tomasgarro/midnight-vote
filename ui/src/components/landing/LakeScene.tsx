import { useEffect, useRef, useState } from 'react';

type SceneFiles = { av1: string; h264: string; start: string; end: string };

const BASE = '/art/civic/lake';
const FILES: Record<'desktop' | 'phone', SceneFiles> = {
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
};

/** Reduced motion and data saver get the finished picture and never fetch the video. */
function prefersStill() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/**
 * The Geneva harbour from the Quai Wilson, engraved in sanguine. Nothing is fetched until the
 * footer is near; when it comes into view a Mouette leaves the harbour past the Pâquis lighthouse
 * and the clouds drift, once, then the scene rests on its last frame.
 */
export function LakeScene() {
  const [files] = useState(() =>
    window.matchMedia('(max-width: 700px)').matches ? FILES.phone : FILES.desktop,
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
    if (still || !near || !element) return;
    let started = false;
    const play = () => {
      element.play().catch(() => setStill(true));
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((entry) => entry.isIntersecting)) return;
        started = true;
        observer.disconnect();
        play();
      },
      { threshold: 0.35 },
    );
    observer.observe(element);
    const onVisibility = () => {
      if (document.hidden) element.pause();
      else if (started && !element.ended) play();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [still, near]);

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
