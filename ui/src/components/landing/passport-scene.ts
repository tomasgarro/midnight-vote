import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * The five Midnight Passport steps as one small 3D world, printed in the page's own materials
 * (ink, rag paper, terracotta) and driven by the scroll timeline:
 * 1. the Midnight Passport opens flat on its data page; money, identity and agents come out;
 * 2. an app asks a question, the hidden details are read, and a proof carries the answer;
 * 3. a seed phrase is crossed out, a fingerprint unlocks the phone, the sheet turns over to
 *    show the recovery backup;
 * 4. a long address is decoded, left to right, into a readable name;
 * 5. agents leave with their own capped, revocable passes.
 *
 * `setTime(t)` takes the timeline's time in screens of scrolling (see PassportJourney.tsx).
 */
export type PassportScene = {
  setTime: (t: number) => void;
  resize: () => void;
  dispose: () => void;
};

const PARTS_AT = 3.0;
const STEP = 0.8;
const INK = '#252823';
const PAPER = '#f3eddf';
const PAPER_HI = '#fbf7ee';
const TERRACOTTA = '#a24f40';
const EMBER = '#e08e7c';
const MUTED = '#6b6d61';
const SERIF = '"Source Serif 4", Georgia, serif';
const SANS = '"IBM Plex Sans", system-ui, sans-serif';
const MONO = 'ui-monospace, Consolas, monospace';
const PPU = 440; // texture pixels per world unit

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
/** 0 before `a`, 1 after `b`, eased in between. */
const span = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
/** Where we are inside step `k` (0 to 1 while it plays). */
const local = (t: number, k: number) => (t - (PARTS_AT + k * STEP)) / STEP;
/** How present step `k`'s own objects are: in at its start, out at its end (the last stays). */
const presence = (t: number, k: number) => {
  const p = local(t, k);
  const fadeIn = span(p, -0.06, 0.14);
  return k === 4 ? fadeIn : fadeIn * (1 - span(p, 0.84, 1.0));
};

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

function canvasOf(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, g: canvas.getContext('2d') as CanvasRenderingContext2D };
}

function toTexture(canvas: HTMLCanvasElement) {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

function texture(w: number, h: number, draw: Draw) {
  const { canvas, g } = canvasOf(w, h);
  draw(g, w, h);
  return toTexture(canvas);
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** The official Midnight symbol, at its own proportions, never stretched or turned. */
function symbol(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  const unit = size / 789.37;
  g.save();
  g.fillStyle = color;
  g.beginPath();
  g.arc(cx, cy, 394.69 * unit, 0, Math.PI * 2);
  g.arc(cx, cy, 321.91 * unit, 0, Math.PI * 2, true);
  g.fill();
  for (const y of [123.69, 240.66, 357.64]) {
    g.fillRect(cx - size / 2 + 357.64 * unit, cy - size / 2 + y * unit, 74.09 * unit, 74.09 * unit);
  }
  g.restore();
}

function hatch(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  g.save();
  roundRect(g, x, y, w, h, h / 3);
  g.clip();
  g.strokeStyle = color;
  g.lineWidth = h * 0.16;
  for (let i = -h; i < w + h; i += h * 0.5) {
    g.beginPath();
    g.moveTo(x + i, y + h);
    g.lineTo(x + i + h, y);
    g.stroke();
  }
  g.restore();
}

function lock(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = s * 0.14;
  g.beginPath();
  g.arc(x + s / 2, y + s * 0.42, s * 0.26, Math.PI, 0);
  g.stroke();
  roundRect(g, x + s * 0.12, y + s * 0.42, s * 0.76, s * 0.52, s * 0.12);
  g.fill();
  g.restore();
}

function check(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = s * 0.16;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(x, y + s * 0.5);
  g.lineTo(x + s * 0.36, y + s * 0.84);
  g.lineTo(x + s, y + s * 0.12);
  g.stroke();
  g.restore();
}

function robot(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = s * 0.08;
  roundRect(g, x + s * 0.12, y + s * 0.28, s * 0.76, s * 0.6, s * 0.16);
  g.stroke();
  g.beginPath();
  g.moveTo(x + s / 2, y + s * 0.28);
  g.lineTo(x + s / 2, y + s * 0.1);
  g.stroke();
  g.beginPath();
  g.arc(x + s / 2, y + s * 0.08, s * 0.06, 0, Math.PI * 2);
  g.fill();
  for (const ex of [0.36, 0.64]) {
    g.beginPath();
    g.arc(x + s * ex, y + s * 0.54, s * 0.07, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function label(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  g.save();
  g.font = `600 ${size}px ${SANS}`;
  g.fillStyle = color;
  g.letterSpacing = `${size * 0.12}px`;
  g.fillText(text.toUpperCase(), x, y);
  g.restore();
}

/** A soft shadow, shared by every card: a blurred rounded rectangle. */
let shadowMap: THREE.Texture | undefined;
function shadow() {
  if (!shadowMap) {
    shadowMap = texture(256, 256, (g) => {
      g.filter = 'blur(22px)';
      g.fillStyle = '#000';
      roundRect(g, 48, 48, 160, 160, 28);
      g.fill();
    });
  }
  return shadowMap;
}

/** Remembers a material's own opacity, so fading multiplies it. */
function base<M extends THREE.Material>(material: M, opacity = 1): M {
  material.userData.base = opacity;
  material.opacity = opacity;
  material.transparent = true;
  return material;
}

/** Fades every material under an object, and hides it when it is gone. */
function fade(object: THREE.Object3D, opacity: number) {
  object.visible = opacity > 0.01;
  object.traverse((child) => {
    const material = (child as THREE.Mesh).material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      const own = typeof m.userData.base === 'number' ? m.userData.base : 1;
      m.transparent = true;
      m.opacity = own * opacity;
      m.depthWrite = opacity > 0.98 && own > 0.98;
    }
  });
}

/** A rounded paper card with a printed face and a soft shadow behind it. */
function card(w: number, h: number, draw: Draw, options: { radius?: number; body?: string } = {}) {
  const radius = options.radius ?? Math.min(w, h) * 0.14;
  const body = options.body ?? PAPER_HI;
  const group = new THREE.Group();
  const depth = 0.045;
  const bodyMesh = new THREE.Mesh(
    new RoundedBoxGeometry(w, h, depth, 6, radius),
    base(new THREE.MeshStandardMaterial({ color: body, roughness: 0.78, metalness: 0 })),
  );
  const tw = Math.round(w * PPU);
  const th = Math.round(h * PPU);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    base(
      new THREE.MeshStandardMaterial({
        map: texture(tw, th, (g) => {
          roundRect(g, 0, 0, tw, th, radius * PPU);
          g.clip();
          draw(g, tw, th);
        }),
        roughness: 0.88,
      }),
    ),
  );
  face.position.z = depth / 2 + 0.002;
  const drop = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 1.32, h * 1.42),
    base(new THREE.MeshBasicMaterial({ map: shadow(), color: '#000', depthWrite: false }), 0.42),
  );
  drop.position.set(0.05, -0.09, -0.12);
  group.add(drop, bodyMesh, face);
  return group;
}

/* ------------------------------------------------------------------------------------------- */
/* The Midnight Passport                                                                        */

/** Fine guilloche, the security pattern of passport pages. */
function guilloche(g: CanvasRenderingContext2D, w: number, h: number, color: string) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 1.1;
  for (let k = 0; k < 22; k += 1) {
    g.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y =
        h * 0.5 +
        Math.sin(x / 38 + k * 0.42) * (h * 0.18) +
        Math.sin(x / 13 + k * 1.3) * 6 +
        (k - 11) * (h / 34);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.restore();
}

function makePassport() {
  const W = 1.0;
  const H = 1.42;
  const T = 0.024;
  const PAGES = 0.085;
  const group = new THREE.Group();

  const leather = texture(512, 728, (g, w, h) => {
    g.fillStyle = '#211d19';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i += 1) {
      const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const y = (Math.sin(i * 78.233) * 12345.6789) % 1;
      g.fillStyle = i % 2 ? 'rgba(255, 240, 220, 0.035)' : 'rgba(0, 0, 0, 0.18)';
      g.fillRect(Math.abs(x) * w, Math.abs(y) * h, 2, 2);
    }
    g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    g.lineWidth = 3;
    roundRect(g, 18, 18, w - 36, h - 36, 22);
    g.stroke();
  });
  const coverMat = new THREE.MeshStandardMaterial({
    map: leather,
    roughness: 0.74,
    metalness: 0.04,
  });
  const foil = new THREE.MeshStandardMaterial({
    map: texture(480, 680, (g, w, h) => {
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.font = `400 48px ${SERIF}`;
      g.letterSpacing = '7px';
      g.fillText('PASSPORT', w / 2, 132);
      symbol(g, w / 2, h * 0.47, 156, '#ffffff');
      g.font = `600 22px ${SANS}`;
      g.letterSpacing = '6px';
      g.fillText('MIDNIGHT', w / 2, h * 0.72);
    }),
    color: '#e8d1a4',
    transparent: true,
    metalness: 0.85,
    roughness: 0.3,
  });

  const back = new THREE.Mesh(new RoundedBoxGeometry(W, H, T, 5, 0.055), coverMat);
  back.position.z = -(PAGES / 2 + T / 2);

  const edges = texture(64, 512, (g, w, h) => {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(120, 104, 80, 0.22)';
    for (let y = 0; y < h; y += 5) g.fillRect(0, y, w, 1);
  });
  const pages = new THREE.Mesh(
    new RoundedBoxGeometry(W * 0.965, H * 0.972, PAGES, 3, 0.02),
    new THREE.MeshStandardMaterial({ map: edges, roughness: 0.95 }),
  );
  pages.position.x = 0.012;

  // The data page: photo, hidden details, a machine-readable zone.
  const dataPage = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.93, H * 0.95),
    new THREE.MeshStandardMaterial({
      roughness: 0.92,
      map: texture(410, 590, (g, w, h) => {
        g.fillStyle = PAPER_HI;
        g.fillRect(0, 0, w, h);
        guilloche(g, w, h, 'rgba(162, 79, 64, 0.08)');
        label(g, 'Midnight Passport', 26, 46, 17, MUTED);
        symbol(g, w - 40, 40, 30, INK);
        roundRect(g, 26, 72, 128, 160, 10);
        g.fillStyle = '#e6dccb';
        g.fill();
        g.fillStyle = '#c9bba3';
        g.beginPath();
        g.arc(90, 134, 28, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.ellipse(90, 214, 46, 34, 0, Math.PI, 0);
        g.fill();
        ['Name', 'Date of birth', 'Nationality', 'Document'].forEach((row, i) => {
          const y = 92 + i * 40;
          label(g, row, 172, y, 13, MUTED);
          hatch(g, 172, y + 8, w - 200, 14, 'rgba(37, 40, 35, 0.4)');
        });
        for (const y of [h - 110, h - 76]) hatch(g, 26, y, w - 52, 18, 'rgba(37, 40, 35, 0.32)');
        label(g, 'Shown only when you choose', 26, h - 30, 14, TERRACOTTA);
      }),
    }),
  );
  dataPage.position.set(0.012, 0, PAGES / 2 + 0.002);

  // The front cover turns on the spine (its left edge).
  const hinge = new THREE.Group();
  hinge.position.set(-W / 2, 0, PAGES / 2 + T / 2);
  const front = new THREE.Mesh(new RoundedBoxGeometry(W, H, T, 5, 0.055), coverMat);
  front.position.x = W / 2;
  const print = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.95, H * 0.95), foil);
  print.position.set(W / 2, 0, T / 2 + 0.002);
  const endpaper = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.93, H * 0.95),
    new THREE.MeshStandardMaterial({
      roughness: 0.92,
      map: texture(410, 590, (g, w, h) => {
        g.fillStyle = '#efe5d3';
        g.fillRect(0, 0, w, h);
        guilloche(g, w, h, 'rgba(162, 79, 64, 0.16)');
        symbol(g, w / 2, h * 0.44, 120, 'rgba(162, 79, 64, 0.22)');
        g.textAlign = 'center';
        g.font = `400 26px ${SERIF}`;
        g.fillStyle = INK;
        g.fillText('Your identity.', w / 2, h * 0.7);
        g.fillText('Your privacy.', w / 2, h * 0.7 + 34);
      }),
    }),
  );
  endpaper.position.set(W / 2, 0, -T / 2 - 0.002);
  endpaper.rotation.y = Math.PI;
  hinge.add(front, print, endpaper);

  group.add(back, pages, dataPage, hinge);
  return { group, hinge, width: W };
}

/* ------------------------------------------------------------------------------------------- */
/* Cards                                                                                        */

function makeMoneyCard() {
  return card(1.04, 0.6, (g, w, h) => {
    g.fillStyle = PAPER_HI;
    g.fillRect(0, 0, w, h);
    label(g, 'Money', 34, 58, 22, MUTED);
    hatch(g, 34, h * 0.44, w * 0.6, 34, 'rgba(37, 40, 35, 0.4)');
    lock(g, w * 0.72, h * 0.4, 46, INK);
    g.font = `400 23px ${SANS}`;
    g.fillStyle = MUTED;
    g.fillText('Only you can move it', 34, h - 34);
  });
}

function makeIdentityCard() {
  return card(1.04, 0.6, (g, w, h) => {
    g.fillStyle = PAPER_HI;
    g.fillRect(0, 0, w, h);
    label(g, 'Identity', 34, 58, 22, MUTED);
    g.fillStyle = '#e6dccb';
    g.beginPath();
    g.arc(84, h * 0.62, 46, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c9bba3';
    g.beginPath();
    g.arc(84, h * 0.55, 17, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(84, h * 0.74, 27, 16, 0, Math.PI, 0);
    g.fill();
    check(g, 160, h * 0.54, 26, TERRACOTTA);
    g.font = `600 31px ${SANS}`;
    g.fillStyle = TERRACOTTA;
    g.fillText('Verified', 198, h * 0.62 + 8);
  });
}

function makeAgentsCard() {
  return card(1.04, 0.6, (g, w, h) => {
    g.fillStyle = PAPER_HI;
    g.fillRect(0, 0, w, h);
    label(g, 'Agents', 34, 58, 22, MUTED);
    robot(g, 34, h * 0.36, 72, INK);
    robot(g, 118, h * 0.36, 72, INK);
    g.font = `600 31px ${SANS}`;
    g.fillStyle = INK;
    g.fillText('2 with a pass', 214, h * 0.64);
  });
}

function makeIdCard() {
  return card(1.56, 1.0, (g, w, h) => {
    g.fillStyle = PAPER_HI;
    g.fillRect(0, 0, w, h);
    symbol(g, 58, 58, 36, INK);
    label(g, 'Midnight Passport', 92, 68, 24, MUTED);
    ['Name', 'Date of birth', 'Document'].forEach((row, i) => {
      const y = 140 + i * 90;
      g.fillStyle = 'rgba(37, 40, 35, 0.1)';
      g.fillRect(34, y - 36, w - 68, 2);
      label(g, row, 34, y + 14, 22, MUTED);
      hatch(g, w * 0.48, y - 6, w * 0.36, 26, 'rgba(37, 40, 35, 0.42)');
      lock(g, w - 80, y - 12, 36, INK);
    });
  });
}

function makeAskCard(answered: boolean) {
  return card(1.1, 0.66, (g, w, h) => {
    g.fillStyle = PAPER_HI;
    g.fillRect(0, 0, w, h);
    label(g, 'Car rental asks', 32, 54, 22, MUTED);
    g.font = `400 54px ${SERIF}`;
    g.fillStyle = INK;
    g.fillText('Over 21?', 32, 128);
    if (answered) {
      roundRect(g, 32, h - 96, w - 64, 62, 31);
      g.fillStyle = TERRACOTTA;
      g.fill();
      check(g, 56, h - 80, 28, PAPER_HI);
      g.font = `600 29px ${SANS}`;
      g.fillStyle = PAPER_HI;
      g.fillText('Yes, proven', 100, h - 54);
    } else {
      g.font = `400 25px ${SANS}`;
      g.fillStyle = MUTED;
      g.fillText('Waiting for a proof…', 32, h - 54);
    }
  });
}

function makeProofToken() {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.05, 64),
    base(new THREE.MeshStandardMaterial({ color: TERRACOTTA, roughness: 0.38, metalness: 0.25 })),
  );
  disc.rotation.x = Math.PI / 2;
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.15, 64),
    base(
      new THREE.MeshStandardMaterial({
        map: texture(128, 128, (g) => check(g, 30, 34, 68, PAPER_HI)),
      }),
    ),
  );
  face.position.z = 0.027;
  group.add(disc, face);
  return group;
}

const SEED = [
  'river',
  'lantern',
  'orbit',
  'velvet',
  'harbor',
  'maple',
  'cinder',
  'quartz',
  'meadow',
  'signal',
  'ember',
  'falcon',
] as const;

/** One sheet, two faces: the seed phrase in front, the recovery backup on the back. */
function makeSeedSheet() {
  const w = 1.2;
  const h = 1.46;
  const group = new THREE.Group();
  const front = card(w, h, (g, tw, th) => {
    g.fillStyle = PAPER_HI;
    g.fillRect(0, 0, tw, th);
    label(g, 'A seed phrase', 36, 62, 24, TERRACOTTA);
    g.font = `400 25px ${SANS}`;
    g.fillStyle = MUTED;
    g.fillText('12 secret words that open a wallet', 36, 104);
    SEED.forEach((word, i) => {
      const x = 36 + (i % 2) * (tw / 2 - 8);
      const y = 178 + Math.floor(i / 2) * 68;
      g.font = `600 22px ${SANS}`;
      g.fillStyle = MUTED;
      g.fillText(String(i + 1).padStart(2, '0'), x, y);
      g.font = `400 31px ${SERIF}`;
      g.fillStyle = INK;
      g.fillText(word, x + 44, y);
    });
    g.font = `600 23px ${SANS}`;
    g.fillStyle = TERRACOTTA;
    g.fillText('Lose it, or show it: the money is gone.', 36, th - 40);
  });
  const backFace = card(w, h, (g, tw, th) => {
    g.fillStyle = PAPER_HI;
    g.fillRect(0, 0, tw, th);
    guilloche(g, tw, th, 'rgba(162, 79, 64, 0.07)');
    label(g, 'Backup', 36, 64, 24, MUTED);
    check(g, 36, 104, 40, TERRACOTTA);
    g.font = `400 46px ${SERIF}`;
    g.fillStyle = INK;
    g.fillText('Recovery', 92, 140);
    g.fillText('is set', 92, 192);
    g.font = `400 26px ${SANS}`;
    g.fillStyle = MUTED;
    [
      'No words to keep.',
      'Restore it on a new phone,',
      'even after losing every',
      'device.',
    ].forEach((line, i) => {
      g.fillText(line, 36, 300 + i * 40);
    });
    symbol(g, tw - 86, th - 86, 92, 'rgba(162, 79, 64, 0.5)');
  });
  backFace.rotation.y = Math.PI;
  backFace.position.z = -0.002;
  // two strokes cross the seed phrase out
  const strike = base(new THREE.MeshStandardMaterial({ color: TERRACOTTA, roughness: 0.5 }));
  const strokes = [0.62, -0.62].map((angle) => {
    const pivot = new THREE.Group();
    const bar = new THREE.Mesh(new RoundedBoxGeometry(1.46, 0.05, 0.02, 2, 0.02), strike);
    bar.position.x = 0.73;
    pivot.add(bar);
    pivot.rotation.z = angle;
    pivot.position.set(-0.55, angle > 0 ? -0.42 : 0.42, 0.04);
    group.add(pivot);
    return pivot;
  });
  group.add(front, backFace);
  return { group, front, back: backFace, strokes };
}

function makePhone() {
  const group = new THREE.Group();
  const w = 0.94;
  const h = 1.9;
  const frame = new THREE.Mesh(
    new RoundedBoxGeometry(w, h, 0.1, 8, 0.16),
    base(new THREE.MeshStandardMaterial({ color: '#3a342d', roughness: 0.3, metalness: 0.7 })),
  );
  const glass = new THREE.Mesh(
    new RoundedBoxGeometry(w * 0.95, h * 0.975, 0.02, 6, 0.14),
    base(new THREE.MeshStandardMaterial({ color: '#15130f', roughness: 0.12, metalness: 0.3 })),
  );
  glass.position.z = 0.05;
  const screenMap = (unlocked: boolean) =>
    texture(430, 880, (g, tw, th) => {
      roundRect(g, 0, 0, tw, th, 58);
      const fill = g.createLinearGradient(0, 0, 0, th);
      fill.addColorStop(0, '#2c2722');
      fill.addColorStop(1, '#191714');
      g.fillStyle = fill;
      g.fill();
      g.textAlign = 'center';
      roundRect(g, tw / 2 - 52, 22, 104, 26, 13);
      g.fillStyle = '#0d0c0a';
      g.fill();
      symbol(g, tw / 2, 132, 62, PAPER);
      g.font = `600 21px ${SANS}`;
      g.fillStyle = 'rgba(243, 237, 223, 0.72)';
      g.letterSpacing = '3px';
      g.fillText('MIDNIGHT PASSPORT', tw / 2, 204);
      g.letterSpacing = '0px';
      g.font = `400 36px ${SERIF}`;
      g.fillStyle = PAPER;
      g.fillText(unlocked ? 'Unlocked' : 'Touch to unlock', tw / 2, th - 132);
      g.font = `400 23px ${SANS}`;
      g.fillStyle = 'rgba(243, 237, 223, 0.62)';
      g.fillText(unlocked ? 'with your passkey' : 'Face or fingerprint', tw / 2, th - 92);
    });
  const locked = screenMap(false);
  const open = screenMap(true);
  const screenMat = base(new THREE.MeshBasicMaterial({ map: locked }));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.94), screenMat);
  screen.position.z = 0.062;
  const print = new THREE.Group();
  const arcs: THREE.Line[] = [];
  const material = base(new THREE.LineBasicMaterial({ color: EMBER }));
  const shapes = [
    [0.045, 215, 505],
    [0.085, 200, 520],
    [0.125, 225, 500],
    [0.165, 205, 515],
    [0.205, 230, 490],
    [0.245, 215, 455],
  ] as const;
  for (const [r, from, to] of shapes) {
    const points: THREE.Vector3[] = [];
    for (let a = from; a <= to; a += 3) {
      const t = (a * Math.PI) / 180;
      points.push(new THREE.Vector3(0.84 * r * Math.sin(t), r * Math.cos(t), 0));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
    arcs.push(line);
    print.add(line);
  }
  print.position.set(0, -0.06, 0.066);
  const drop = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 1.4, h * 1.3),
    base(new THREE.MeshBasicMaterial({ map: shadow(), color: '#000', depthWrite: false }), 0.45),
  );
  drop.position.set(0.06, -0.12, -0.14);
  group.add(drop, frame, glass, screen, print);
  return {
    group,
    draw(progress: number, unlocked: boolean) {
      arcs.forEach((line, i) => {
        const count = line.geometry.attributes.position?.count ?? 0;
        const own = clamp01(progress * 1.4 - i * 0.07);
        line.geometry.setDrawRange(0, Math.floor(count * own));
      });
      material.color.set(unlocked ? PAPER : EMBER);
      screenMat.map = unlocked ? open : locked;
    },
  };
}

/** One card that decodes a long address into a name, left to right, as `q` goes from 0 to 1. */
function makeDecoder() {
  const w = 2.5;
  const h = 0.8;
  const tw = Math.round(w * PPU);
  const th = Math.round(h * PPU);
  const radius = 0.12 * PPU;
  const { canvas, g } = canvasOf(tw, th);
  const map = toTexture(canvas);
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(w, h, 0.045, 6, 0.12),
    base(new THREE.MeshStandardMaterial({ color: PAPER_HI, roughness: 0.78 })),
  );
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    base(new THREE.MeshStandardMaterial({ map, roughness: 0.88 })),
  );
  face.position.z = 0.025;
  const drop = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 1.2, h * 1.6),
    base(new THREE.MeshBasicMaterial({ map: shadow(), color: '#000', depthWrite: false }), 0.42),
  );
  drop.position.set(0.05, -0.09, -0.12);
  group.add(drop, body, face);

  const ADDRESS = 'mn_addr1qx7d93l2u5c0v8k2f8w0m3n6fj9w4z0ckq8';
  const GLYPHS = 'abcdefghjkmnpqrstuvwxyz0123456789';
  let last = -1;
  function draw(q: number) {
    const key = Math.round(q * 240);
    if (key === last) return;
    last = key;
    g.clearRect(0, 0, tw, th);
    g.save();
    roundRect(g, 0, 0, tw, th, radius);
    g.clip();
    g.fillStyle = PAPER_HI;
    g.fillRect(0, 0, tw, th);
    const band = 120;
    const frontX = mix(-band, tw + band, q);
    // the label turns from what it was to what it is
    g.globalAlpha = 1 - smooth(q * 2);
    label(g, 'Instead of a long address', 40, 66, 22, MUTED);
    g.globalAlpha = smooth(q * 2 - 1);
    label(g, 'You are', 40, 66, 22, TERRACOTTA);
    g.globalAlpha = 1;
    const baseline = th - 96;
    // still to decode: the address
    g.save();
    g.beginPath();
    g.rect(frontX, 0, tw, th);
    g.clip();
    g.font = `400 40px ${MONO}`;
    g.fillStyle = MUTED;
    g.fillText(ADDRESS, 40, baseline);
    g.restore();
    // decoded: the name
    g.save();
    g.beginPath();
    g.rect(0, 0, Math.max(0, frontX - band), th);
    g.clip();
    g.font = `400 96px ${SERIF}`;
    g.fillStyle = INK;
    g.fillText('yourname', 40, baseline + 18);
    const nameWidth = g.measureText('yourname').width;
    g.font = `400 46px ${SERIF}`;
    g.fillStyle = TERRACOTTA;
    g.fillText('.passport.night', 40 + nameWidth + 8, baseline + 18);
    g.restore();
    // the decoding edge: characters still turning over
    g.save();
    g.beginPath();
    g.rect(frontX - band, 0, band, th);
    g.clip();
    g.font = `600 40px ${MONO}`;
    g.fillStyle = EMBER;
    for (let x = 40, i = 0; x < tw; x += 24, i += 1) {
      const n = Math.abs(Math.sin((i + key * 0.37) * 12.9898) * 43758.5453) % 1;
      g.fillText(GLYPHS[Math.floor(n * GLYPHS.length)] ?? 'x', x, baseline);
    }
    g.fillStyle = 'rgba(224, 142, 124, 0.35)';
    g.fillRect(frontX - 3, 30, 3, th - 60);
    g.restore();
    g.restore();
    map.needsUpdate = true;
  }
  draw(0);
  return { group, draw };
}

const AGENTS = [
  { name: 'Travel agent', may: 'Books trains', cap: 'Up to CHF 80 a month' },
  { name: 'Video agent', may: 'Edits your videos', cap: 'With the skills you give it' },
  { name: 'Grocery agent', may: 'Does the weekly shop', cap: 'Never above CHF 120' },
] as const;

function makeAgentPass(agent: (typeof AGENTS)[number]) {
  return card(1.38, 0.64, (g, w, h) => {
    g.fillStyle = PAPER_HI;
    g.fillRect(0, 0, w, h);
    robot(g, 30, 24, 60, INK);
    g.font = `400 35px ${SERIF}`;
    g.fillStyle = INK;
    g.fillText(agent.name, 104, 70);
    roundRect(g, w - 178, 38, 146, 40, 20);
    g.strokeStyle = 'rgba(37, 40, 35, 0.28)';
    g.lineWidth = 2;
    g.stroke();
    label(g, 'Revocable', w - 160, 65, 16, MUTED);
    g.font = `600 27px ${SANS}`;
    g.fillStyle = INK;
    g.fillText(agent.may, 32, h - 74);
    g.font = `400 25px ${SANS}`;
    g.fillStyle = TERRACOTTA;
    g.fillText(agent.cap, 32, h - 36);
  });
}

/* ------------------------------------------------------------------------------------------- */

export async function createPassportScene(canvas: HTMLCanvasElement): Promise<PassportScene> {
  await document.fonts.ready;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = studio;
  scene.environmentIntensity = 0.32;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 7.6);
  scene.add(new THREE.HemisphereLight('#f6e7d4', '#2a1d18', 0.45));
  const key = new THREE.DirectionalLight('#ffe4c6', 1.7);
  key.position.set(-3, 4, 5);
  const rim = new THREE.DirectionalLight(EMBER, 1.3);
  rim.position.set(4, 1.5, -2);
  scene.add(key, rim);

  const root = new THREE.Group();
  scene.add(root);

  const passport = makePassport();
  const money = makeMoneyCard();
  const identity = makeIdentityCard();
  const agents = makeAgentsCard();
  const idCard = makeIdCard();
  const ask = makeAskCard(false);
  const asked = makeAskCard(true);
  const token = makeProofToken();
  const scan = new THREE.Mesh(
    new THREE.PlaneGeometry(1.36, 0.05),
    base(
      new THREE.MeshBasicMaterial({
        map: texture(512, 16, (g, w, h) => {
          const glow = g.createLinearGradient(0, 0, w, 0);
          glow.addColorStop(0, 'rgba(255, 243, 228, 0)');
          glow.addColorStop(0.5, 'rgba(255, 243, 228, 1)');
          glow.addColorStop(1, 'rgba(255, 243, 228, 0)');
          g.fillStyle = glow;
          g.fillRect(0, h * 0.3, w, h * 0.4);
        }),
        depthWrite: false,
      }),
    ),
  );
  const sheet = makeSeedSheet();
  const phone = makePhone();
  const decoder = makeDecoder();
  const passes = AGENTS.map(makeAgentPass);
  const threadMaterial = base(new THREE.LineBasicMaterial({ color: EMBER }));
  const threads = passes.map(() => new THREE.Line(new THREE.BufferGeometry(), threadMaterial));
  root.add(passport.group, money, identity, agents, idCard, ask, asked, token, scan);
  root.add(sheet.group, phone.group, decoder.group, ...passes, ...threads);

  let time = 0;
  let width = 1;
  let height = 1;
  let narrow = false;
  let frame = 0;
  let running = false;
  const started = performance.now();
  const elapsed = () => (performance.now() - started) / 1000;

  const place = (object: THREE.Object3D, x: number, y: number, z = 0, s = 1, ry = 0, rx = 0) => {
    object.position.set(x, y, z);
    object.scale.setScalar(s);
    object.rotation.set(rx, ry, 0);
  };

  function pose(t: number, idle: number) {
    const float = (seed: number) => Math.sin(idle * 0.8 + seed) * 0.02;
    const sway = (seed: number) => Math.sin(idle * 0.5 + seed) * 0.035;
    const n = narrow ? 0.82 : 1; // a narrow window draws the world a little tighter

    // The Midnight Passport: rises in, opens flat on its data page, then steps aside but stays.
    const arrive = span(t, PARTS_AT - 0.3, PARTS_AT + 0.05);
    const open = span(local(t, 0), 0.06, 0.34) * (1 - span(local(t, 1), -0.02, 0.2));
    const aside = span(local(t, 1), -0.05, 0.2);
    const center = span(local(t, 4), -0.1, 0.15);
    // hidden from the start of step 3 until step 4 begins
    const awayFor3 = span(local(t, 2), -0.08, 0.08) * (1 - span(local(t, 3), 0.0, 0.15));
    const px = mix(mix(-0.05 * n, -1.15 * n, aside), -0.8 * n, center);
    const py = mix(mix(-0.02, -0.82, aside), 0.0, center);
    const ps = mix(mix(1.0, 0.58, aside), 0.92, center);
    place(
      passport.group,
      px,
      py + float(0) - (1 - arrive) * 0.6,
      0,
      ps,
      mix(0.16, 0.22, aside) + sway(1),
      -0.04,
    );
    passport.hinge.rotation.y = -open * Math.PI * 0.94;
    fade(passport.group, arrive * (1 - awayFor3));

    // 1. One place: money, identity and agents come out of the data page.
    const p1 = local(t, 0);
    const one = presence(t, 0);
    [money, identity, agents].forEach((object, i) => {
      const k = span(p1, 0.24 + i * 0.08, 0.52 + i * 0.08);
      const tx = 1.02 * n;
      const ty = 0.74 - i * 0.74;
      place(
        object,
        mix(px, tx, k),
        mix(py, ty, k) + float(i + 2),
        mix(0.1, 0.45, k),
        mix(0.25, 1, k) * n,
        -0.2 + sway(i),
      );
      fade(object, one * k);
    });

    // 2. Show only what is asked: the app asks, the details are read into a proof, the proof goes.
    const p2 = local(t, 1);
    const two = presence(t, 1);
    const idX = -0.1 * n;
    place(idCard, idX, 0.1 + float(5), 0.3, mix(0.86, 1, span(p2, 0, 0.2)) * n, 0.14 + sway(5));
    fade(idCard, two);
    const scanK = span(p2, 0.24, 0.46);
    place(scan, idX, 0.1 + mix(0.36, -0.36, scanK) * n, 0.36, n, 0.14 + sway(5));
    fade(scan, two * Math.sin(scanK * Math.PI));
    const answered = span(p2, 0.6, 0.66);
    const askX = 1.0 * n;
    place(ask, askX, 0.92 + float(6), 0.5, mix(0.6, 1, span(p2, 0.08, 0.22)) * n, -0.24 + sway(6));
    place(asked, askX, 0.92 + float(6), 0.51, n, -0.24 + sway(6));
    fade(ask, two * span(p2, 0.08, 0.2) * (1 - answered));
    fade(asked, two * answered);
    const fly = span(p2, 0.46, 0.62);
    const lift = Math.sin(fly * Math.PI) * 0.45;
    place(
      token,
      mix(idX, askX, fly),
      mix(0.1, 0.72, fly) + lift,
      0.8,
      mix(0.4, 1, span(p2, 0.44, 0.5)) * n,
      fly * Math.PI * 2,
    );
    fade(token, two * span(p2, 0.44, 0.48) * (1 - span(p2, 0.6, 0.66)));

    // 3. No seed phrase: the phrase is crossed out, a fingerprint unlocks the phone, and the sheet
    //    turns over to show the recovery backup.
    const p3 = local(t, 2);
    const three = presence(t, 2);
    const turn = span(p3, 0.5, 0.68);
    place(
      sheet.group,
      -0.78 * n,
      0.1 + float(7),
      0.25,
      mix(0.9, 1, span(p3, 0.02, 0.16)) * n,
      0.22 + turn * Math.PI + sway(7) * (1 - turn),
    );
    fade(sheet.group, three * span(p3, 0.02, 0.14));
    sheet.strokes.forEach((stroke, i) => {
      const k = span(p3, 0.26 + i * 0.07, 0.36 + i * 0.07);
      stroke.scale.set(Math.max(0.001, k), 1, 1);
      stroke.visible = k > 0.001 && turn < 0.5;
    });
    sheet.front.visible = turn < 0.5;
    sheet.back.visible = turn >= 0.5;
    place(
      phone.group,
      0.62 * n,
      0.0 + float(9),
      0.2,
      mix(0.86, 1, span(p3, 0, 0.18)) * n,
      -0.22 + sway(9),
    );
    phone.draw(span(p3, 0.2, 0.46), p3 > 0.48);
    fade(phone.group, three);

    // 4. A name: the long address is decoded, left to right, into a name.
    const p4 = local(t, 3);
    const four = presence(t, 3);
    decoder.draw(span(p4, 0.2, 0.62));
    place(
      decoder.group,
      0.12 * n,
      0.12 + float(10),
      0.3,
      mix(0.8, 1, span(p4, 0, 0.18)) * n,
      -0.1 + sway(10),
    );
    fade(decoder.group, four);

    // 5. Agents: each leaves with its own pass, tied back to the Midnight Passport.
    const p5 = local(t, 4);
    const five = presence(t, 4);
    passes.forEach((object, i) => {
      const k = span(p5, 0.12 + i * 0.12, 0.34 + i * 0.12);
      const tx = 0.92 * n;
      const ty = 0.8 - i * 0.8;
      place(
        object,
        mix(px, tx, k),
        mix(py, ty, k) + float(12 + i),
        0.35,
        mix(0.35, 1, k) * n,
        -0.24 + sway(12 + i),
      );
      fade(object, five * k);
      const thread = threads[i];
      if (thread) {
        const from = new THREE.Vector3(px + 0.32 * ps, py, 0.12);
        const to = new THREE.Vector3(
          object.position.x - 0.69 * n,
          object.position.y,
          object.position.z,
        );
        const curve = new THREE.CubicBezierCurve3(
          from,
          new THREE.Vector3(from.x + 0.45, from.y, 0.25),
          new THREE.Vector3(to.x - 0.45, to.y, 0.3),
          to,
        );
        thread.geometry.setFromPoints(curve.getPoints(40));
        thread.geometry.setDrawRange(0, Math.floor(41 * k));
        thread.visible = five * k > 0.01;
      }
    });
    threadMaterial.opacity = five * 0.85;
  }

  function layout() {
    const aspect = width / height;
    narrow = aspect < 1.05;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const viewH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const viewW = viewH * aspect;
    if (!narrow) {
      // the left half of the stage; the words take the right
      const left = -viewW / 2 + viewW * 0.03;
      const right = viewW * 0.01;
      root.position.set((left + right) / 2 + viewW * 0.01, -viewH * 0.01, 0);
      root.scale.setScalar(Math.min(1.25, (right - left) / 3.2, viewH / 3.1));
    } else {
      // the upper half on a narrow window; the words sit below
      root.position.set(viewW * 0.02, viewH * 0.19, 0);
      root.scale.setScalar(Math.min(0.95, (viewW * 0.96) / 3.0, (viewH * 0.46) / 2.5));
    }
  }

  function render() {
    frame = 0;
    pose(time, elapsed());
    renderer.render(scene, camera);
    if (running) frame = requestAnimationFrame(render);
  }

  function resize() {
    width = canvas.clientWidth || 1;
    height = canvas.clientHeight || 1;
    renderer.setSize(width, height, false);
    layout();
  }

  resize();
  return {
    setTime(t) {
      time = t;
      const active = t > PARTS_AT - 0.45 && t < PARTS_AT + 5 * STEP + 0.6;
      if (active && !running) {
        running = true;
        if (!frame) frame = requestAnimationFrame(render);
      } else if (!active && running) {
        running = false;
        pose(time, elapsed());
        renderer.render(scene, camera);
      }
    },
    resize,
    dispose() {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        for (const m of Array.isArray(material) ? material : material ? [material] : []) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
      });
      studio.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
