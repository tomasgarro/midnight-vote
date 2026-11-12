import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { HandSource, HeroAssets } from './hero-assets';
import { MidnightMark } from './MidnightMark';

const POINTER_MEDIA =
  '(min-width: 600px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';

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
  const video = assets.hands.kind === 'packed-video';
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
    const current = { x: 0, y: 0, radius: 0, rx: 0, ry: 0, tx: 0, ty: 0 };
    const target = { ...current };
    const paint = () => {
      stage.style.setProperty('--reveal-x', `${current.x}px`);
      stage.style.setProperty('--reveal-y', `${current.y}px`);
      stage.style.setProperty('--reveal-radius', `${current.radius}px`);
      stage.style.setProperty('--hand-rx', `${current.rx}deg`);
      stage.style.setProperty('--hand-ry', `${current.ry}deg`);
      stage.style.setProperty('--hand-tx', `${current.tx}px`);
      stage.style.setProperty('--hand-ty', `${current.ty}px`);
      // The video's circle is drawn inside the moving hand: undo the hand's drift so it stays under the cursor.
      revealRef.current = {
        x: current.x - current.tx,
        y: current.y - current.ty,
        radius: current.radius,
      };
    };
    const tick = (time: number) => {
      const blend = 1 - Math.exp(-Math.min(time - (lastTime || time - 16), 64) / 150);
      lastTime = time;
      let unsettled = false;
      for (const key of ['x', 'y', 'radius', 'rx', 'ry', 'tx', 'ty'] as const) {
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
      Object.assign(current, { radius: 0, rx: 0, ry: 0, tx: 0, ty: 0 });
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
        if (target.radius || target.rx || target.ry || target.tx || target.ty) {
          Object.assign(target, { radius: 0, rx: 0, ry: 0, tx: 0, ty: 0 });
          schedule();
        }
        return;
      }
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const clamp = (value: number) => Math.max(-1, Math.min(1, value));
      // The arm leans from the wrist towards the cursor and drifts a little after it, as a held-up
      // hand does; tilting the flat picture in depth read as a card, so it only turns in the plane.
      const towardsY = clamp(((event.clientY - surfaceBounds.top) / surfaceBounds.height) * 2 - 1);
      const towardsX = clamp(((event.clientX - surfaceBounds.left) / surfaceBounds.width) * 2 - 1);
      target.rx = 0;
      target.ry = towardsX * 3.5;
      target.tx = towardsX * 14;
      target.ty = towardsY * 8;
      const shorter = Math.min(bounds.width, bounds.height);
      const passport = Math.hypot(
        x - bounds.width * assets.symbol.x,
        y - bounds.height * assets.symbol.y,
      );
      const passportInfluence = smooth(Math.max(0, 1 - passport / (shorter * 0.65)));
      const palm = Math.hypot(x - bounds.width * assets.palm.x, y - bounds.height * assets.palm.y);
      // Both hands hold the same passport, so the difference is in the hand: it opens as wide
      // there as on the cover, and the circle is big enough to reach the fingers from the cover.
      const palmInfluence = smooth(Math.max(0, 1 - palm / (bounds.width * 0.5)));
      const inside = x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height;
      target.radius = inside
        ? 12 + (shorter * 0.5 - 12) * Math.max(passportInfluence, palmInfluence)
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
      Object.assign(target, { radius: 0, rx: 0, ry: 0, tx: 0, ty: 0 });
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
    // A little scrolling keeps the reveal alive; once the zoom starts, it closes.
    const scroll = () => {
      if (!visible) return;
      bounds = stage.getBoundingClientRect();
      surfaceBounds = surface.getBoundingClientRect();
      if (!revealAllowed.current) {
        Object.assign(target, { radius: 0, rx: 0, ry: 0, tx: 0, ty: 0 });
        schedule();
      }
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
        <div className="hero-hand__pose">
          <StackedHands
            source={assets.hands as Extract<HandSource, { kind: 'packed-video' }>}
            reveal={revealRef}
            revealOn={pointerEnabled}
            onReady={videoReady}
            onFail={videoFailed}
          />
        </div>
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
      {/* For the zoom: the night shows through the ring, and the camera flies through it. */}
      <div className="hero-hand__portal" aria-hidden="true" />
      <MidnightMark className="hero-hand__symbol hero-hand__symbol--zoom" />
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
 * The render's two hands come in one video, so they can never drift apart. The video is a 2 x 2
 * grid: human colour | human alpha over agent colour | agent alpha, each colour premultiplied on
 * black. A small shader puts each colour back on its alpha and shows the agent inside the reveal
 * circle.
 */
const VERTEX = `
attribute vec2 p;
varying vec2 uv;
void main() {
  uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;
const FRAGMENT = `
precision mediump float;
uniform sampler2D video;
uniform vec2 size;
uniform vec2 texel;
uniform vec3 reveal;
varying vec2 uv;
vec4 hand(float row) {
  vec2 q = clamp(uv, texel, 1.0 - texel) * 0.5;
  vec3 colour = texture2D(video, vec2(q.x, q.y + row * 0.5)).rgb;
  float alpha = texture2D(video, vec2(q.x + 0.5, q.y + row * 0.5)).r;
  alpha = clamp((alpha - 0.03) / 0.94, 0.0, 1.0);
  return vec4(min(colour, vec3(alpha)), alpha);
}
void main() {
  vec4 colour = hand(0.0);
  if (reveal.z > 0.5) {
    float inside = 1.0 - smoothstep(reveal.z - 1.5, reveal.z, distance(uv * size, reveal.xy));
    if (inside > 0.0) colour = mix(colour, hand(1.0), inside);
  }
  gl_FragColor = colour;
}`;

function StackedHands({
  source,
  reveal,
  revealOn,
  onReady,
  onFail,
}: {
  source: Extract<HandSource, { kind: 'packed-video' }>;
  reveal: RefObject<Reveal>;
  revealOn: boolean;
  onReady: () => void;
  onFail: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [painted, setPainted] = useState(false);
  /** No WebGL: the rest frame stands in for the loop. */
  const [flat, setFlat] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const element = videoRef.current;
    if (!canvas || !element || still || flat) return;
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
    });
    const compile = (type: number, text: string) => {
      const shader = gl?.createShader(type);
      if (!gl || !shader) return null;
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = gl && compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = gl && compile(gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl?.createProgram();
    if (!gl || !vertex || !fragment || !program) {
      setFlat(true);
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setFlat(true);
      return;
    }
    // biome-ignore lint/correctness/useHookAtTopLevel: a WebGL call, not a React hook
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const uSize = gl.getUniformLocation(program, 'size');
    const uTexel = gl.getUniformLocation(program, 'texel');
    const uReveal = gl.getUniformLocation(program, 'reveal');
    gl.clearColor(0, 0, 0, 0);

    let frame = 0;
    let visible = true;
    let shown = false;
    const draw = () => {
      frame = 0;
      if (element.readyState >= 2 && element.videoWidth) {
        const ratio = window.devicePixelRatio || 1;
        const w = Math.round(canvas.clientWidth * ratio);
        const h = Math.round(canvas.clientHeight * ratio);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        gl.viewport(0, 0, w, h);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, element);
        const { x, y, radius } = reveal.current;
        gl.uniform2f(uSize, w, h);
        gl.uniform2f(uTexel, 1 / element.videoWidth, 1 / element.videoHeight);
        gl.uniform3f(uReveal, x * ratio, y * ratio, revealOn ? radius * ratio : 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!shown) {
          shown = true;
          setPainted(true);
        }
      }
      if (visible && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const play = () => {
      element.play().catch(() => undefined);
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible) play();
      else element.pause();
    });
    const visibility = () => {
      if (document.hidden) element.pause();
      else if (visible) play();
    };
    observer.observe(canvas);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [reveal, revealOn, still, flat]);

  if (still || flat) {
    return (
      <img
        className="hero-hand__poster"
        src={source.poster}
        alt=""
        onLoad={onReady}
        onError={onFail}
      />
    );
  }
  return (
    <>
      {/* The rest frame holds the place until the first video frame is drawn. */}
      {!painted && <img className="hero-hand__poster" src={source.poster} alt="" />}
      <canvas ref={canvasRef} className="hero-hand__canvas" />
      <video
        ref={videoRef}
        className="hero-hand__source"
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        onLoadedData={onReady}
        onError={onFail}
      >
        {source.av1 && <source src={source.av1} type='video/mp4; codecs="av01.0.12M.08"' />}
        {/* A video never reports its sources' errors; the last one failing means none can play. */}
        <source src={source.h264} type="video/mp4" onError={onFail} />
      </video>
    </>
  );
}
