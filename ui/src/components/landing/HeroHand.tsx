import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { HandSource, HeroAssets } from './hero-assets';

const POINTER_MEDIA =
  '(min-width: 901px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';

type Reveal = { x: number; y: number; radius: number };

/**
 * The hand holding the Midnight Passport. Under a mouse, a circle opens near the passport and the
 * same pose shows an agent's hand. Decorative only: it never touches the visitor's session.
 *
 * `revealAllowed` is false once the page has scrolled into the zoom, because the reveal measures
 * the hand in its unzoomed place.
 */
export function HeroHand({
  assets,
  surfaceRef,
  revealAllowed,
}: {
  assets: HeroAssets;
  surfaceRef: RefObject<HTMLElement | null>;
  revealAllowed: RefObject<boolean>;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<Reveal>({ x: 0, y: 0, radius: 0 });
  const [pointerEnabled, setPointerEnabled] = useState(false);
  const [humanReady, setHumanReady] = useState(false);
  const [agentReady, setAgentReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const video = assets.hands.kind === 'stacked-video';
  const videoReady = useCallback(() => {
    setHumanReady(true);
    setAgentReady(true);
  }, []);
  const videoFailed = useCallback(() => setFailed(true), []);

  useEffect(() => {
    const media = window.matchMedia(POINTER_MEDIA);
    const sync = () =>
      setPointerEnabled(
        media.matches && CSS.supports('mask-image', 'radial-gradient(#000, transparent)'),
      );
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const interactive = pointerEnabled && humanReady && agentReady && !failed;

  useEffect(() => {
    const stage = stageRef.current;
    const surface = surfaceRef.current;
    if (!stage || !surface || !interactive) return;

    let bounds = stage.getBoundingClientRect();
    let surfaceBounds = surface.getBoundingClientRect();
    let frame = 0;
    let lastTime = 0;
    let visible = true;
    let tracking = false;
    const current = { x: 0, y: 0, radius: 0, rx: 0, ry: 0 };
    const target = { ...current };
    const paint = () => {
      stage.style.setProperty('--reveal-x', `${current.x}px`);
      stage.style.setProperty('--reveal-y', `${current.y}px`);
      stage.style.setProperty('--reveal-radius', `${current.radius}px`);
      stage.style.setProperty('--hand-rx', `${current.rx}deg`);
      stage.style.setProperty('--hand-ry', `${current.ry}deg`);
      revealRef.current = { x: current.x, y: current.y, radius: current.radius };
    };
    const tick = (time: number) => {
      const blend = 1 - Math.exp(-Math.min(time - (lastTime || time - 16), 64) / 150);
      lastTime = time;
      let unsettled = false;
      for (const key of ['x', 'y', 'radius', 'rx', 'ry'] as const) {
        current[key] += (target[key] - current[key]) * blend;
        if (Math.abs(target[key] - current[key]) > 0.01) unsettled = true;
        else current[key] = target[key];
      }
      paint();
      frame = unsettled ? requestAnimationFrame(tick) : 0;
      if (!unsettled) lastTime = 0;
    };
    const schedule = () => {
      if (!frame && visible && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      tracking = false;
      Object.assign(current, { radius: 0, rx: 0, ry: 0 });
      Object.assign(target, current);
      paint();
    };
    const measure = () => {
      reset();
      bounds = stage.getBoundingClientRect();
      surfaceBounds = surface.getBoundingClientRect();
    };
    const smooth = (value: number) => value * value * (3 - 2 * value);
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !visible || document.hidden) return;
      if (!revealAllowed.current) {
        if (target.radius || target.rx || target.ry) {
          Object.assign(target, { radius: 0, rx: 0, ry: 0 });
          schedule();
        }
        return;
      }
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const clamp = (value: number) => Math.max(-1, Math.min(1, value));
      target.rx = -clamp(((event.clientY - surfaceBounds.top) / surfaceBounds.height) * 2 - 1) * 4;
      target.ry = clamp(((event.clientX - surfaceBounds.left) / surfaceBounds.width) * 2 - 1) * 4;
      const shorter = Math.min(bounds.width, bounds.height);
      const passport = Math.hypot(
        x - bounds.width * assets.symbol.x,
        y - bounds.height * assets.symbol.y,
      );
      const passportInfluence = smooth(Math.max(0, 1 - passport / (shorter * 0.65)));
      const palm = Math.hypot(x - bounds.width * assets.palm.x, y - bounds.height * assets.palm.y);
      const palmInfluence = smooth(Math.max(0, 1 - palm / (bounds.width * 0.42))) * 0.75;
      const inside = x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height;
      target.radius = inside
        ? 12 + (shorter * 0.35 - 12) * Math.max(passportInfluence, palmInfluence)
        : 0;
      target.x = x;
      target.y = y;
      if (!tracking) {
        current.x = x;
        current.y = y;
        tracking = true;
      }
      schedule();
    };
    const leave = () => {
      tracking = false;
      Object.assign(target, { radius: 0, rx: 0, ry: 0 });
      schedule();
    };
    const visibility = () => {
      if (document.hidden) reset();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (!visible) reset();
      else measure();
    });
    const scroll = () => {
      if (visible) measure();
    };
    const resize = new ResizeObserver(measure);
    observer.observe(stage);
    resize.observe(stage);
    surface.addEventListener('pointermove', move, { passive: true });
    surface.addEventListener('pointerleave', leave);
    window.addEventListener('resize', measure, { passive: true });
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      observer.disconnect();
      resize.disconnect();
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerleave', leave);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', visibility);
      reset();
    };
  }, [surfaceRef, revealAllowed, interactive, assets]);

  const symbolStyle = {
    '--sx': assets.symbol.x,
    '--sy': assets.symbol.y,
    '--ss': assets.symbol.size,
    '--srot': `${assets.symbol.rotate}deg`,
    '--sskew': `${assets.symbol.skewX}deg`,
  } as CSSProperties;

  return (
    <div
      ref={stageRef}
      className="hero-hand"
      data-interactive={interactive}
      data-failed={failed}
      data-symbol-baked={assets.symbol.baked}
      style={{
        ...symbolStyle,
        aspectRatio: `${assets.frame.width} / ${assets.frame.height}`,
      }}
      role="img"
      aria-label="A hand holding a Midnight Passport"
    >
      {video ? (
        <StackedHands
          source={assets.hands as Extract<HandSource, { kind: 'stacked-video' }>}
          reveal={revealRef}
          revealOn={pointerEnabled}
          onReady={videoReady}
          onFail={videoFailed}
        />
      ) : (
        <>
          <div className="hero-hand__window hero-hand__window--human" aria-hidden="true">
            <div className="hero-hand__pose">
              <StillHand
                assets={assets}
                which="human"
                onLoad={() => setHumanReady(true)}
                onError={() => setFailed(true)}
              />
              <img
                className="hero-hand__symbol"
                src="/brand/midnight-symbol-white.svg"
                alt=""
                draggable="false"
                hidden={!humanReady}
              />
            </div>
          </div>
          {pointerEnabled && !failed && (
            <div className="hero-hand__window hero-hand__window--agent" aria-hidden="true">
              <div className="hero-hand__pose">
                <StillHand
                  assets={assets}
                  which="agent"
                  onLoad={() => setAgentReady(true)}
                  onError={() => setAgentReady(false)}
                />
                <img
                  className="hero-hand__symbol hero-hand__symbol--agent"
                  src="/brand/midnight-symbol-black.svg"
                  alt=""
                  draggable="false"
                />
              </div>
            </div>
          )}
        </>
      )}
      {/* For the zoom: the cover darkens to the chapter's black under a symbol drawn above it. */}
      <div className="hero-hand__shade" aria-hidden="true" />
      <img
        className="hero-hand__symbol hero-hand__symbol--zoom"
        src="/brand/midnight-symbol-white.svg"
        alt=""
        draggable="false"
      />
      {failed && <p className="hero-hand__fallback">Your identity. Your privacy.</p>}
    </div>
  );
}

function StillHand({
  assets,
  which,
  onLoad,
  onError,
}: {
  assets: HeroAssets;
  which: 'human' | 'agent';
  onLoad: () => void;
  onError: () => void;
}) {
  if (assets.hands.kind !== 'stills') return null;
  const { size, crop } = assets.hands;
  return (
    <img
      className="hero-hand__picture"
      src={assets.hands[which]}
      alt=""
      width={size.width}
      height={size.height}
      fetchPriority={which === 'human' ? 'high' : 'low'}
      draggable="false"
      onLoad={onLoad}
      onError={onError}
      style={{
        width: `${(size.width / crop.width) * 100}%`,
        height: `${(size.height / crop.height) * 100}%`,
        left: `${(-crop.x / crop.width) * 100}%`,
        top: `${(-crop.y / crop.height) * 100}%`,
      }}
    />
  );
}

/**
 * The render's two hands come in one video, so they can never drift apart: the human half is
 * drawn, then the agent half inside the reveal circle.
 */
function StackedHands({
  source,
  reveal,
  revealOn,
  onReady,
  onFail,
}: {
  source: Extract<HandSource, { kind: 'stacked-video' }>;
  reveal: RefObject<Reveal>;
  revealOn: boolean;
  onReady: () => void;
  onFail: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const canvas = canvasRef.current;
    const element = videoRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !element || !context || still) return;
    let frame = 0;
    let visible = true;
    const draw = () => {
      frame = 0;
      const width = element.videoWidth;
      const half = element.videoHeight / 2;
      if (width && half) {
        const ratio = window.devicePixelRatio || 1;
        const w = Math.round(canvas.clientWidth * ratio);
        const h = Math.round(canvas.clientHeight * ratio);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        context.clearRect(0, 0, w, h);
        context.drawImage(element, 0, 0, width, half, 0, 0, w, h);
        const { x, y, radius } = reveal.current;
        if (revealOn && radius > 0.5) {
          context.save();
          context.beginPath();
          context.arc(x * ratio, y * ratio, radius * ratio, 0, Math.PI * 2);
          context.clip();
          context.drawImage(element, 0, half, width, half, 0, 0, w, h);
          context.restore();
        }
      }
      if (visible && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const start = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible) {
        element.play().catch(onFail);
        start();
      } else element.pause();
    });
    const visibility = () => {
      if (document.hidden) element.pause();
      else if (visible) {
        element.play().catch(onFail);
        start();
      }
    };
    observer.observe(canvas);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [reveal, revealOn, still, onFail]);

  if (still) return <img className="hero-hand__poster" src={source.poster} alt="" />;
  return (
    <>
      <canvas ref={canvasRef} className="hero-hand__canvas" />
      <video
        ref={videoRef}
        className="hero-hand__source"
        muted
        loop
        playsInline
        preload="auto"
        poster={source.poster}
        disablePictureInPicture
        onLoadedData={onReady}
        onError={onFail}
      >
        {source.av1 && <source src={source.av1} type='video/mp4; codecs="av01.0.08M.08"' />}
        <source src={source.h264} type="video/mp4" />
      </video>
    </>
  );
}
