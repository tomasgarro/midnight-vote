import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * The five Midnight Passport steps as one small 3D world, printed in the page's own materials
 * (ink, rag paper, terracotta) and driven by the scroll timeline: the Midnight Passport opens and
 * its money, identity and agents come out; an app asks a question and gets a proof; a seed phrase
 * folds away for a passkey; a long address becomes a name; agents leave with their passes.
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
const NIGHT = '#1d1b17';
const PAPER = '#f3eddf';
const PAPER_HI = '#fffdf8';
const TERRACOTTA = '#a24f40';
const EMBER = '#e08e7c';
const MUTED = '#6b6d61';
const SERIF = '"Source Serif 4", Georgia, serif';
const SANS = '"IBM Plex Sans", system-ui, sans-serif';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
/** 0 before `a`, 1 after `b`, eased in between. */
const span = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
/** Where we are inside step `k` (0 to 1 while it plays). */
const local = (t: number, k: number) => (t - (PARTS_AT + k * STEP)) / STEP;
/** How present step `k`'s own objects are: in at its start, out at its end (the last one stays). */
const presence = (t: number, k: number) => {
  const p = local(t, k);
  const fadeIn = span(p, -0.06, 0.14);
  return k === 4 ? fadeIn : fadeIn * (1 - span(p, 0.84, 1.0));
};

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

function texture(w: number, h: number, draw: Draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  draw(g, w, h);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
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

/** The official Midnight symbol, at its own proportions, never stretched. */
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
  roundRect(g, x, y, w, h, h / 4);
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
  roundRect(g, x + s * 0.12, y + s * 0.42, s * 0.76, s * 0.52, s * 0.1);
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
  roundRect(g, x + s * 0.12, y + s * 0.28, s * 0.76, s * 0.6, s * 0.14);
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

/** A paper card: a rounded body and a printed face. */
function card(w: number, h: number, draw: Draw, body = PAPER_HI) {
  const group = new THREE.Group();
  const depth = 0.035;
  const bodyMesh = new THREE.Mesh(
    new RoundedBoxGeometry(w, h, depth, 4, Math.min(w, h) * 0.08),
    new THREE.MeshStandardMaterial({ color: body, roughness: 0.82, metalness: 0.0 }),
  );
  const ppu = 420;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.985, h * 0.975),
    new THREE.MeshStandardMaterial({
      map: texture(Math.round(w * ppu), Math.round(h * ppu), draw),
      transparent: true,
      roughness: 0.9,
    }),
  );
  face.position.z = depth / 2 + 0.002;
  group.add(bodyMesh, face);
  return group;
}

/** Fades every material under a group, and hides it when it is gone. */
function fade(object: THREE.Object3D, opacity: number) {
  object.visible = opacity > 0.01;
  object.traverse((child) => {
    const material = (child as THREE.Mesh).material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = opacity > 0.98;
    }
  });
}

function label(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  g.font = `600 ${size}px ${SANS}`;
  g.fillStyle = color;
  g.save();
  g.letterSpacing = `${size * 0.12}px`;
  g.fillText(text.toUpperCase(), x, y);
  g.restore();
}

/* ------------------------------------------------------------------------------------------- */

function makePassport() {
  const group = new THREE.Group();
  const w = 1.0;
  const h = 1.38;
  const coverMat = new THREE.MeshStandardMaterial({
    color: NIGHT,
    roughness: 0.62,
    metalness: 0.08,
  });
  const back = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.03, 3, 0.04), coverMat);
  back.position.z = -0.07;
  const pages = new THREE.Mesh(
    new RoundedBoxGeometry(w * 0.95, h * 0.96, 0.11, 2, 0.02),
    new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.95 }),
  );
  pages.position.set(0.012, 0, 0);
  const inside = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.9, h * 0.9),
    new THREE.MeshStandardMaterial({
      transparent: true,
      roughness: 0.95,
      map: texture(420, 580, (g, tw, th) => {
        label(g, 'Midnight Passport', 34, 70, 26, MUTED);
        g.fillStyle = 'rgba(37, 40, 35, 0.12)';
        for (let i = 0; i < 6; i += 1) g.fillRect(34, 120 + i * 72, tw - 68, 2);
        symbol(g, tw - 80, th - 80, 64, 'rgba(37, 40, 35, 0.35)');
      }),
    }),
  );
  inside.position.set(0.012, 0, 0.056);
  // the front cover turns on the spine (left edge)
  const hinge = new THREE.Group();
  hinge.position.set(-w / 2, 0, 0.075);
  const front = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.03, 3, 0.04), coverMat);
  front.position.x = w / 2;
  const print = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.96, h * 0.96),
    new THREE.MeshStandardMaterial({
      transparent: true,
      roughness: 0.4,
      metalness: 0.35,
      map: texture(480, 664, (g, tw, th) => {
        g.textAlign = 'center';
        g.fillStyle = PAPER;
        g.font = `400 46px ${SERIF}`;
        g.save();
        g.letterSpacing = '6px';
        g.fillText('PASSPORT', tw / 2, 130);
        g.restore();
        symbol(g, tw / 2, th * 0.46, 150, PAPER);
        g.font = `600 22px ${SANS}`;
        g.save();
        g.letterSpacing = '5px';
        g.fillText('MIDNIGHT', tw / 2, th * 0.7);
        g.restore();
      }),
    }),
  );
  print.position.set(w / 2, 0, 0.017);
  hinge.add(front, print);
  group.add(back, pages, inside, hinge);
  return { group, hinge };
}

function makeMoneyCard() {
  return card(1.0, 0.56, (g, w, h) => {
    label(g, 'Money', 30, 52, 22, MUTED);
    hatch(g, 30, h * 0.46, w * 0.62, 34, 'rgba(37, 40, 35, 0.4)');
    lock(g, w * 0.72, h * 0.42, 44, INK);
    g.font = `400 22px ${SANS}`;
    g.fillStyle = MUTED;
    g.fillText('Only you can move it', 30, h - 30);
  });
}

function makeIdentityCard() {
  return card(1.0, 0.56, (g, _w, h) => {
    label(g, 'Identity', 30, 52, 22, MUTED);
    g.fillStyle = '#e6dccb';
    g.beginPath();
    g.arc(78, h * 0.6, 44, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c9bba3';
    g.beginPath();
    g.arc(78, h * 0.53, 17, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(78, h * 0.72, 27, 16, 0, Math.PI, 0);
    g.fill();
    g.font = `600 30px ${SANS}`;
    g.fillStyle = TERRACOTTA;
    check(g, 150, h * 0.52, 26, TERRACOTTA);
    g.fillText('Verified', 188, h * 0.6 + 8);
  });
}

function makeAgentsCard() {
  return card(1.0, 0.56, (g, w, h) => {
    label(g, 'Agents', 30, 52, 22, MUTED);
    robot(g, 30, h * 0.36, 70, INK);
    robot(g, 112, h * 0.36, 70, INK);
    g.font = `600 30px ${SANS}`;
    g.fillStyle = INK;
    g.fillText('2 with a pass', 206, h * 0.62);
    void w;
  });
}

function makeIdCard() {
  return card(1.5, 0.98, (g, w) => {
    symbol(g, 52, 54, 34, INK);
    label(g, 'Midnight Passport', 84, 64, 24, MUTED);
    const rows = ['Name', 'Date of birth', 'Document'];
    rows.forEach((row, i) => {
      const y = 130 + i * 88;
      g.fillStyle = 'rgba(37, 40, 35, 0.12)';
      g.fillRect(30, y - 34, w - 60, 2);
      label(g, row, 30, y + 14, 22, MUTED);
      hatch(g, w * 0.48, y - 6, w * 0.38, 26, 'rgba(37, 40, 35, 0.42)');
      lock(g, w - 74, y - 12, 36, INK);
    });
  });
}

function makeAskCard(answered: boolean) {
  return card(1.06, 0.62, (g, w, h) => {
    label(g, 'Car rental asks', 28, 50, 22, MUTED);
    g.font = `400 52px ${SERIF}`;
    g.fillStyle = INK;
    g.fillText('Over 21?', 28, 122);
    if (answered) {
      roundRect(g, 28, h - 92, w - 56, 62, 31);
      g.fillStyle = TERRACOTTA;
      g.fill();
      check(g, 52, h - 76, 28, PAPER_HI);
      g.font = `600 28px ${SANS}`;
      g.fillStyle = PAPER_HI;
      g.fillText('Yes, proven', 96, h - 50);
    } else {
      g.font = `400 24px ${SANS}`;
      g.fillStyle = MUTED;
      g.fillText('Waiting for a proof…', 28, h - 52);
    }
  });
}

function makeProofToken() {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 0.05, 48),
    new THREE.MeshStandardMaterial({ color: TERRACOTTA, roughness: 0.45, metalness: 0.2 }),
  );
  disc.rotation.x = Math.PI / 2;
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.14, 48),
    new THREE.MeshStandardMaterial({
      transparent: true,
      map: texture(128, 128, (g) => check(g, 30, 34, 68, PAPER_HI)),
    }),
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
];

function makeSeedSheet() {
  return card(1.16, 1.42, (g, w, h) => {
    label(g, 'A seed phrase', 34, 58, 24, TERRACOTTA);
    g.font = `400 24px ${SANS}`;
    g.fillStyle = MUTED;
    g.fillText('12 secret words that open a wallet', 34, 98);
    SEED.forEach((word, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 34 + col * (w / 2 - 10);
      const y = 168 + row * 66;
      g.font = `600 22px ${SANS}`;
      g.fillStyle = MUTED;
      g.fillText(String(i + 1).padStart(2, '0'), x, y);
      g.font = `400 30px ${SERIF}`;
      g.fillStyle = INK;
      g.fillText(word, x + 42, y);
    });
    g.font = `600 22px ${SANS}`;
    g.fillStyle = TERRACOTTA;
    g.fillText('Lose it, or show it: the money is gone.', 34, h - 36);
  });
}

function makeBackupCard() {
  return card(1.16, 0.7, (g, w, h) => {
    label(g, 'Backup', 32, 56, 22, MUTED);
    check(g, 32, 92, 34, TERRACOTTA);
    g.font = `400 40px ${SERIF}`;
    g.fillStyle = INK;
    g.fillText('Recovery is set', 82, 124);
    g.font = `400 24px ${SANS}`;
    g.fillStyle = MUTED;
    g.fillText('Restore it on a new phone,', 32, h - 70);
    g.fillText('even after losing every device.', 32, h - 36);
    void w;
  });
}

function makePhone() {
  const group = new THREE.Group();
  const w = 0.92;
  const h = 1.86;
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(w, h, 0.09, 6, 0.13),
    new THREE.MeshStandardMaterial({ color: '#2e2a25', roughness: 0.38, metalness: 0.45 }),
  );
  const screenMap = (unlocked: boolean) =>
    texture(440, 900, (g, tw, th) => {
      const fill = g.createLinearGradient(0, 0, 0, th);
      fill.addColorStop(0, '#2b2621');
      fill.addColorStop(1, '#1a1815');
      roundRect(g, 0, 0, tw, th, 52);
      g.fillStyle = fill;
      g.fill();
      g.textAlign = 'center';
      symbol(g, tw / 2, 120, 64, PAPER);
      g.font = `600 22px ${SANS}`;
      g.fillStyle = 'rgba(243, 237, 223, 0.7)';
      g.save();
      g.letterSpacing = '3px';
      g.fillText('MIDNIGHT PASSPORT', tw / 2, 196);
      g.restore();
      g.font = `400 34px ${SERIF}`;
      g.fillStyle = PAPER;
      g.fillText(unlocked ? 'Unlocked' : 'Touch to unlock', tw / 2, th - 130);
      g.font = `400 22px ${SANS}`;
      g.fillStyle = 'rgba(243, 237, 223, 0.6)';
      g.fillText(unlocked ? 'with your passkey' : 'Face or fingerprint', tw / 2, th - 90);
    });
  const locked = screenMap(false);
  const open = screenMap(true);
  const screenMat = new THREE.MeshStandardMaterial({
    map: locked,
    transparent: true,
    roughness: 0.3,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.94), screenMat);
  screen.position.z = 0.047;
  // the fingerprint: open arcs drawn on as it is read
  const print = new THREE.Group();
  const arcs: THREE.Line[] = [];
  const material = new THREE.LineBasicMaterial({ color: EMBER, transparent: true });
  const shapes = [
    [0.04, 215, 505],
    [0.08, 200, 520],
    [0.12, 225, 500],
    [0.16, 205, 515],
    [0.2, 230, 490],
    [0.24, 215, 455],
  ] as const;
  for (const [r, from, to] of shapes) {
    const points: THREE.Vector3[] = [];
    for (let a = from; a <= to; a += 4) {
      const t = (a * Math.PI) / 180;
      points.push(new THREE.Vector3(0.84 * r * Math.sin(t), r * Math.cos(t), 0));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
    arcs.push(line);
    print.add(line);
  }
  print.position.set(0, -0.05, 0.05);
  group.add(body, screen, print);
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

function makeAddress() {
  return card(2.7, 0.34, (g, w, h) => {
    g.font = `400 34px ui-monospace, Consolas, monospace`;
    g.fillStyle = MUTED;
    g.fillText('mn_addr1qx7d93l2u5c0v8k2f8w0m3n6fj9w4z0ckq8', 30, h / 2 + 12);
    void w;
  });
}

function makeName() {
  return card(2.0, 0.72, (g, w, h) => {
    label(g, 'You are', 34, 54, 22, MUTED);
    g.font = `400 84px ${SERIF}`;
    g.fillStyle = INK;
    g.fillText('yourname', 34, h - 50);
    const width = g.measureText('yourname').width;
    g.font = `400 40px ${SERIF}`;
    g.fillStyle = TERRACOTTA;
    g.fillText('.passport.night', 34 + width + 6, h - 50);
    void w;
  });
}

const AGENTS = [
  { name: 'Travel agent', may: 'Books trains', cap: 'Up to CHF 80 a month' },
  { name: 'Video agent', may: 'Edits your videos', cap: 'With the skills you give it' },
  { name: 'Grocery agent', may: 'Does the weekly shop', cap: 'Never above CHF 120' },
] as const;

function makeAgentPass(agent: (typeof AGENTS)[number]) {
  return card(1.34, 0.6, (g, w, h) => {
    robot(g, 26, 22, 58, INK);
    g.font = `400 34px ${SERIF}`;
    g.fillStyle = INK;
    g.fillText(agent.name, 98, 66);
    roundRect(g, w - 170, 34, 142, 40, 20);
    g.strokeStyle = 'rgba(37, 40, 35, 0.3)';
    g.lineWidth = 2;
    g.stroke();
    label(g, 'Revocable', w - 152, 62, 16, MUTED);
    g.font = `600 26px ${SANS}`;
    g.fillStyle = INK;
    g.fillText(agent.may, 28, h - 70);
    g.font = `400 24px ${SANS}`;
    g.fillStyle = TERRACOTTA;
    g.fillText(agent.cap, 28, h - 32);
  });
}

/* ------------------------------------------------------------------------------------------- */

export async function createPassportScene(canvas: HTMLCanvasElement): Promise<PassportScene> {
  await document.fonts.ready;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0, 7.2);
  scene.add(new THREE.HemisphereLight('#f6e7d4', '#2a1d18', 1.1));
  const key = new THREE.DirectionalLight('#ffe2c2', 2.4);
  key.position.set(-3, 4, 5);
  const rim = new THREE.DirectionalLight(EMBER, 1.6);
  rim.position.set(4, 1, -2);
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
    new THREE.PlaneGeometry(1.56, 0.03),
    new THREE.MeshBasicMaterial({ color: '#fff3e4', transparent: true }),
  );
  const seed = makeSeedSheet();
  const backup = makeBackupCard();
  const phone = makePhone();
  const address = makeAddress();
  const name = makeName();
  const passes = AGENTS.map(makeAgentPass);
  const threadMaterial = new THREE.LineBasicMaterial({ color: EMBER, transparent: true });
  const threads = passes.map(() => {
    const line = new THREE.Line(new THREE.BufferGeometry(), threadMaterial);
    return line;
  });
  root.add(passport.group, money, identity, agents, idCard, ask, asked, token, scan);
  root.add(seed, backup, phone.group, address, name, ...passes, ...threads);

  let time = 0;
  let width = 1;
  let height = 1;
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
    const float = (seed: number) => Math.sin(idle * 0.8 + seed) * 0.025;
    const sway = (seed: number) => Math.sin(idle * 0.5 + seed) * 0.04;

    // The Midnight Passport: rises in, opens for step 1, then steps aside but stays in the world.
    const arrive = span(t, PARTS_AT - 0.25, PARTS_AT + 0.05);
    const open = span(local(t, 0), 0.08, 0.32) * (1 - span(local(t, 1), 0.0, 0.2));
    const aside = span(local(t, 1), -0.05, 0.2);
    const center = span(local(t, 4), -0.1, 0.15);
    const hideFor3 = presence(t, 2) * (1 - span(local(t, 3), 0.0, 0.15));
    const px = mix(mix(0.0, -1.05, aside), -0.75, center);
    const py = mix(mix(-0.05, -0.85, aside), 0.0, center);
    const ps = mix(mix(1.1, 0.62, aside), 0.95, center);
    place(
      passport.group,
      px,
      py + float(0) - (1 - arrive) * 0.6,
      0,
      ps,
      mix(0.5, 0.18, aside) + sway(1),
    );
    passport.hinge.rotation.y = -open * 2.05;
    fade(passport.group, arrive * (1 - hideFor3));

    // 1. One place: money, identity and agents come out of the open passport.
    const p1 = local(t, 0);
    const out = (i: number) => span(p1, 0.22 + i * 0.08, 0.5 + i * 0.08);
    const one = presence(t, 0);
    [money, identity, agents].forEach((object, i) => {
      const k = out(i);
      const tx = 1.08;
      const ty = 0.72 - i * 0.72;
      place(
        object,
        mix(0.0, tx, k),
        mix(-0.05, ty, k) + float(i + 2),
        mix(0.1, 0.4, k),
        mix(0.3, 1, k),
        -0.22 + sway(i),
      );
      fade(object, one * k);
    });

    // 2. Show only what is asked: the app asks, the details are read into a proof, the proof goes.
    const p2 = local(t, 1);
    const two = presence(t, 1);
    place(idCard, -0.05, 0.12 + float(5), 0.3, mix(0.85, 1, span(p2, 0, 0.2)), 0.16 + sway(5));
    fade(idCard, two);
    const scanK = span(p2, 0.24, 0.46);
    place(scan, -0.05, 0.12 + mix(0.42, -0.42, scanK), 0.36, 1, 0.16);
    fade(scan, two * (scanK > 0 && scanK < 1 ? 1 : 0) * 0.9);
    const answered = span(p2, 0.6, 0.66);
    place(ask, 1.0, 0.95 + float(6), 0.5, mix(0.6, 1, span(p2, 0.08, 0.22)), -0.28 + sway(6));
    place(asked, 1.0, 0.95 + float(6), 0.51, 1, -0.28 + sway(6));
    fade(ask, two * span(p2, 0.08, 0.2) * (1 - answered));
    fade(asked, two * answered);
    const fly = span(p2, 0.46, 0.62);
    const arcLift = Math.sin(fly * Math.PI) * 0.45;
    place(
      token,
      mix(-0.05, 1.0, fly),
      mix(0.12, 0.75, fly) + arcLift,
      0.8,
      mix(0.4, 1, span(p2, 0.44, 0.5)),
      fly * Math.PI * 2,
    );
    fade(token, two * span(p2, 0.44, 0.48) * (1 - span(p2, 0.6, 0.66)));

    // 3. No seed phrase: here is what a seed phrase is; it folds away; a passkey unlocks the phone;
    //    recovery is set.
    const p3 = local(t, 2);
    const three = presence(t, 2);
    const fold = span(p3, 0.48, 0.62);
    seed.scale.set(1 - fold * 0.2, 1 - fold * 0.95, 1);
    seed.position.set(-0.78, 0.15 + float(7) + fold * 0.4, 0.2);
    seed.rotation.set(fold * 0.9, 0.3 + sway(7), 0);
    fade(seed, three * span(p3, 0.02, 0.16) * (1 - fold));
    place(backup, -0.78, 0.05 + float(8), 0.25, mix(0.7, 1, span(p3, 0.58, 0.72)), 0.3 + sway(8));
    fade(backup, three * span(p3, 0.58, 0.7));
    place(phone.group, 0.55, 0.0 + float(9), 0.2, mix(0.85, 1, span(p3, 0, 0.18)), -0.25 + sway(9));
    phone.draw(span(p3, 0.18, 0.46), p3 > 0.5);
    fade(phone.group, three);

    // 4. A name: the long address squeezes away and the name takes its place.
    const p4 = local(t, 3);
    const four = presence(t, 3);
    const squeeze = span(p4, 0.22, 0.44);
    address.scale.set(1 - squeeze * 0.9, 1, 1);
    address.position.set(0.05 - squeeze * 0.4, 0.42 + float(10), 0.3);
    address.rotation.set(0, -0.12 + sway(10), 0);
    fade(address, four * (1 - squeeze));
    place(name, 0.05, -0.12 + float(11), 0.35, mix(0.6, 1, span(p4, 0.36, 0.55)), -0.14 + sway(11));
    fade(name, four * span(p4, 0.36, 0.52));

    // 5. Agents: each leaves with its own pass, tied back to the Midnight Passport.
    const p5 = local(t, 4);
    const five = presence(t, 4);
    passes.forEach((object, i) => {
      const k = span(p5, 0.12 + i * 0.12, 0.32 + i * 0.12);
      const tx = 0.9;
      const ty = 0.78 - i * 0.78;
      place(
        object,
        mix(-0.6, tx, k),
        mix(0, ty, k) + float(12 + i),
        0.35,
        mix(0.4, 1, k),
        -0.26 + sway(12 + i),
      );
      fade(object, five * k);
      const thread = threads[i];
      if (thread) {
        const from = new THREE.Vector3(px + 0.3, py, 0.1);
        const to = new THREE.Vector3(
          object.position.x - 0.67,
          object.position.y,
          object.position.z,
        );
        const curve = new THREE.QuadraticBezierCurve3(
          from,
          new THREE.Vector3((from.x + to.x) / 2, (from.y + to.y) / 2 + 0.15, 0.3),
          to,
        );
        thread.geometry.setFromPoints(curve.getPoints(32));
        thread.geometry.setDrawRange(0, Math.floor(33 * k));
        thread.visible = five * k > 0.01;
      }
    });
    threadMaterial.opacity = five * 0.8;
  }

  function layout() {
    const aspect = width / height;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const viewH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const viewW = viewH * aspect;
    if (aspect >= 1.05) {
      // the left half of the stage; the words take the right
      const left = -viewW / 2 + viewW * 0.05;
      const right = viewW * 0.02;
      root.position.set((left + right) / 2, -viewH * 0.02, 0);
      root.scale.setScalar(Math.min(1.25, (right - left) / 3.1, viewH / 3.0));
    } else {
      // the upper half on a narrow window; the words sit below
      root.position.set(0, viewH * 0.2, 0);
      root.scale.setScalar(Math.min(0.92, (viewW * 0.94) / 3.4, (viewH * 0.48) / 2.6));
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
      const active = t > PARTS_AT - 0.4 && t < PARTS_AT + 5 * STEP + 0.6;
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
      renderer.dispose();
    },
  };
}
