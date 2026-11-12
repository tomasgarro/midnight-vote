import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BEATS, PARTS_AT, STEP, STEPS } from './passport-beats';

/**
 * The 3D objects of the five Midnight Passport steps, printed in the page's own materials (leather,
 * gold foil, rag paper, terracotta) and driven by the scroll timeline. Everything that is
 * information is a glass card in the page (PassportChapter.tsx); the scene draws only what is
 * better as an object, into the empty slots the page lays out (`data-slot`), so the objects line up
 * with the cards and the words at every width:
 * 1. the closed Midnight Passport, in relief (`cover-1`);
 * 2. it opens on its data page (`page`); the hidden details are read and a proof flies to the
 *    app's question (`proof`);
 * 3. a seed phrase is crossed out, a fingerprint unlocks the phone, and the sheet turns over to
 *    show the recovery backup (`sheet`, `phone`);
 * 5. the closed Midnight Passport again (`cover-5`), tied by threads to the agents' passes
 *    (`agent-0` to `agent-2`).
 *
 * `setTime(t)` takes the timeline's time in screens of scrolling (see PassportJourney.tsx).
 */
export type PassportScene = {
  setTime: (t: number) => void;
  resize: () => void;
  dispose: () => void;
};

const INK = '#252823';
const PAPER = '#f3eddf';
const PAPER_HI = '#fbf7ee';
const TERRACOTTA = '#a24f40';
const EMBER = '#e08e7c';
const MUTED = '#6b6d61';
const SERIF = '"Source Serif 4", Georgia, serif';
const SANS = '"IBM Plex Sans", system-ui, sans-serif';

/** The Midnight Passport: cover width and height, cover and page-block thickness (world units). */
const W = 1.0;
const H = 1.42;
const T = 0.026;
const PAGES = 0.08;
/** The page block, a little inside the covers, and the data page printed on it. */
const BLOCK_W = W * 0.965;
const BLOCK_H = H * 0.972;
const PAGE_W = W * 0.93;
const PAGE_H = H * 0.945;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const x = clamp01(v);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
/** 0 before `a`, 1 after `b`, eased in between. */
const span = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
const between = (t: number, [a, b]: readonly [number, number]) => span(t, a, b);
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
/** Where we are inside step `k` (0 to 1 while it plays). */
const local = (t: number, k: number) => (t - (PARTS_AT + k * STEP)) / STEP;
/** How present step `k`'s own objects are: in as it starts, out as it ends (the last stays). */
const presence = (t: number, k: number) => {
  const p = local(t, k);
  const fadeIn = span(p, -0.06, 0.1);
  return k === STEPS - 1 ? fadeIn : fadeIn * (1 - span(p, 0.84, 1.0));
};

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

function canvasOf(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return {
    canvas,
    g: canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D,
  };
}

function toTexture(canvas: HTMLCanvasElement, srgb = true) {
  const map = new THREE.CanvasTexture(canvas);
  if (srgb) map.colorSpace = THREE.SRGBColorSpace;
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

/** Fine guilloche, the security pattern of passport pages. */
function guilloche(g: CanvasRenderingContext2D, w: number, h: number, color: string) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = w / 380;
  for (let k = 0; k < 22; k += 1) {
    g.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y =
        h * 0.5 +
        Math.sin(x / (w / 11) + k * 0.42) * (h * 0.18) +
        Math.sin(x / (w / 32) + k * 1.3) * (w / 70) +
        (k - 11) * (h / 34);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.restore();
}

/** A soft shadow, shared by every object: a blurred rounded rectangle. */
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

function dropShadow(w: number, h: number, opacity = 0.45) {
  const drop = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    base(new THREE.MeshBasicMaterial({ map: shadow(), color: '#000', depthWrite: false }), opacity),
  );
  drop.renderOrder = -1;
  return drop;
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

/** A tube along a curve that can be drawn on from its start, `k` from 0 to 1. */
function reveal(mesh: THREE.Mesh, k: number) {
  const segments = mesh.userData.segments as number;
  const radial = mesh.userData.radial as number;
  mesh.geometry.setDrawRange(0, Math.floor(segments * clamp01(k)) * radial * 6);
  mesh.visible = k > 0.001;
}

function tube(
  curve: THREE.Curve<THREE.Vector3>,
  radius: number,
  segments: number,
  material: THREE.Material,
) {
  const radial = 6;
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, segments, radius, radial, false),
    material,
  );
  mesh.userData.segments = segments;
  mesh.userData.radial = radial;
  return mesh;
}

/* ------------------------------------------------------------------------------------------- */
/* Relief: pebbled leather, a debossed foil, stitches                                           */

/** Integer hash noise in [0, 1). */
function hash(x: number, y: number, seed: number) {
  let h =
    Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Pebbled leather as a tileable height field: rounded pebbles (1) between narrow creases (0),
 * `size` pixels square, with pebbles about `cell` pixels across.
 */
function grain(size: number, cell: number) {
  const n = Math.max(2, Math.round(size / cell));
  const c = size / n;
  const fx = new Float32Array(n * n);
  const fy = new Float32Array(n * n);
  for (let j = 0; j < n; j += 1)
    for (let i = 0; i < n; i += 1) {
      fx[j * n + i] = (i + 0.12 + 0.76 * hash(i, j, 1)) * c;
      fy[j * n + i] = (j + 0.12 + 0.76 * hash(i, j, 2)) * c;
    }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const ci = Math.floor(x / c);
      const cj = Math.floor(y / c);
      let d1 = 1e9;
      let d2 = 1e9;
      let tone = 0;
      for (let dj = -1; dj <= 1; dj += 1)
        for (let di = -1; di <= 1; di += 1) {
          const ii = ci + di;
          const jj = cj + dj;
          const wi = (ii + n) % n;
          const wj = (jj + n) % n;
          const px = (fx[wj * n + wi] ?? 0) + (ii - wi) * c;
          const py = (fy[wj * n + wi] ?? 0) + (jj - wj) * c;
          const d = (px - x) ** 2 + (py - y) ** 2;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            tone = hash(wi, wj, 3);
          } else if (d < d2) d2 = d;
        }
      const edge = clamp01((Math.sqrt(d2) - Math.sqrt(d1)) / (c * 0.55));
      out[y * size + x] = edge * (2 - edge) * (0.82 + 0.18 * tone);
    }
  return out;
}

/** A canvas's red channel as 0 to 1. */
function maskOf(canvas: HTMLCanvasElement) {
  const g = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
  const out = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < out.length; i += 1) out[i] = (data[i * 4] ?? 0) / 255;
  return out;
}

/** Draws white on black and returns it as a mask. */
function paintMask(w: number, h: number, draw: Draw) {
  const { canvas, g } = canvasOf(w, h);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  draw(g, w, h);
  return maskOf(canvas);
}

/** A soft copy of a mask: two separable box blurs of radius `r`, close to a Gaussian. */
function soften(mask: Float32Array, w: number, h: number, r: number) {
  const a = mask.slice();
  const b = new Float32Array(mask.length);
  const n = 2 * r + 1;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 0; y < h; y += 1) {
      let sum = 0;
      for (let x = -r; x <= r; x += 1) sum += a[y * w + Math.min(w - 1, Math.max(0, x))] ?? 0;
      for (let x = 0; x < w; x += 1) {
        b[y * w + x] = sum / n;
        sum += (a[y * w + Math.min(w - 1, x + r + 1)] ?? 0) - (a[y * w + Math.max(0, x - r)] ?? 0);
      }
    }
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let y = -r; y <= r; y += 1) sum += b[Math.min(h - 1, Math.max(0, y)) * w + x] ?? 0;
      for (let y = 0; y < h; y += 1) {
        a[y * w + x] = sum / n;
        sum += (b[Math.min(h - 1, y + r + 1) * w + x] ?? 0) - (b[Math.max(0, y - r) * w + x] ?? 0);
      }
    }
  }
  return a;
}

/** Writes tangent-space normals of rows [y0, y1) of a height field into an image. */
function normalRows(
  height: Float32Array,
  w: number,
  h: number,
  strength: number,
  wrap: boolean,
  data: Uint8ClampedArray,
  y0: number,
  y1: number,
) {
  const at = (x: number, y: number) => {
    const xx = wrap ? (x + w) % w : Math.min(w - 1, Math.max(0, x));
    const yy = wrap ? (y + h) % h : Math.min(h - 1, Math.max(0, y));
    return height[yy * w + xx] ?? 0;
  };
  for (let y = y0; y < y1; y += 1)
    for (let x = 0; x < w; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const length = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      data[i] = (-dx / length) * 127.5 + 127.5;
      data[i + 1] = (dy / length) * 127.5 + 127.5;
      data[i + 2] = (1 / length) * 127.5 + 127.5;
      data[i + 3] = 255;
    }
}

/** Tangent-space normals from a height field (strength in pixels of slope per unit of height). */
function normalsOf(height: Float32Array, w: number, h: number, strength: number, wrap: boolean) {
  const { canvas, g } = canvasOf(w, h);
  const image = g.createImageData(w, h);
  normalRows(height, w, h, strength, wrap, image.data, 0, h);
  g.putImageData(image, 0, 0);
  return canvas;
}

/** Hands the page back between slices of heavy work, so scrolling never waits for it. */
const idle = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });

const LEATHER: [number, number, number] = [36, 31, 26];
const FOIL: [number, number, number] = [222, 194, 140];
const THREAD: [number, number, number] = [126, 108, 84];

/** The leather of the back, the spine and the edges: a small tile of the same grain. */
function leatherTile() {
  const size = 256;
  const height = grain(size, 9);
  const { canvas, g } = canvasOf(size, size);
  const image = g.createImageData(size, size);
  const rm = canvasOf(size, size);
  const rmImage = rm.g.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const v = height[i] ?? 0;
    const shade = 0.74 + 0.3 * v;
    image.data[i * 4] = LEATHER[0] * shade;
    image.data[i * 4 + 1] = LEATHER[1] * shade;
    image.data[i * 4 + 2] = LEATHER[2] * shade;
    image.data[i * 4 + 3] = 255;
    rmImage.data[i * 4 + 1] = (0.56 + 0.26 * (1 - v)) * 255;
    rmImage.data[i * 4 + 2] = 0.04 * 255;
    rmImage.data[i * 4 + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  rm.g.putImageData(rmImage, 0, 0);
  const tile = (map: THREE.Texture) => {
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(3, 4);
    return map;
  };
  return {
    height,
    material: new THREE.MeshStandardMaterial({
      map: tile(toTexture(canvas)),
      normalMap: tile(toTexture(normalsOf(height, size, size, 2.2, true), false)),
      roughnessMap: tile(toTexture(rm.canvas, false)),
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.8,
    }),
  };
}

/**
 * The front cover's face. At once: the leather with its foil printed flat. Then, a slice at a time
 * while the page is idle, the relief: pebbled leather, the foil (PASSPORT, the Midnight symbol,
 * MIDNIGHT) pressed into it with bevelled edges, a stitched border and the hinge groove by the
 * spine, as colour, normals, and roughness (G) with metalness (B).
 */
function coverFace(tile: Float32Array, tileSize: number) {
  const w = 600;
  const h = Math.round(w * (H / W));
  const px = w / W;
  const foilArt: Draw = (g) => {
    g.textAlign = 'center';
    g.font = `500 ${w * 0.1}px ${SERIF}`;
    g.letterSpacing = `${w * 0.016}px`;
    g.fillText('PASSPORT', w / 2, h * 0.205);
    symbol(g, w / 2, h * 0.47, w * 0.33, g.fillStyle as string);
    g.font = `600 ${w * 0.046}px ${SANS}`;
    g.letterSpacing = `${w * 0.014}px`;
    g.fillText('MIDNIGHT', w / 2, h * 0.715);
  };
  const inset = 0.05 * px;
  const border = (g: CanvasRenderingContext2D) => {
    roundRect(g, inset, inset, w - 2 * inset, h - 2 * inset, 0.05 * px);
    g.stroke();
  };
  const material = new THREE.MeshStandardMaterial({
    map: texture(w, h, (g) => {
      g.fillStyle = `rgb(${LEATHER.join(', ')})`;
      g.fillRect(0, 0, w, h);
      g.fillStyle = `rgb(${FOIL.join(', ')})`;
      foilArt(g, w, h);
    }),
    roughness: 0.7,
    metalness: 0.1,
    envMapIntensity: 1.5,
  });

  async function relief() {
    const foil = paintMask(w, h, foilArt);
    const stitch = paintMask(w, h, (g) => {
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.setLineDash([8, 6]);
      border(g);
    });
    const groove = paintMask(w, h, (g) => {
      g.lineWidth = 4;
      border(g);
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0.075 * px, 0);
      g.lineTo(0.075 * px, h);
      g.stroke();
    });
    await idle();
    const foilSoft = soften(foil, w, h, 2);
    const stitchSoft = soften(stitch, w, h, 1);
    const grooveSoft = soften(groove, w, h, 1);
    await idle();

    const height = new Float32Array(w * h);
    const color = canvasOf(w, h);
    const colorImage = color.g.createImageData(w, h);
    const rm = canvasOf(w, h);
    const rmImage = rm.g.createImageData(w, h);
    const rows = 160;
    for (let y0 = 0; y0 < h; y0 += rows) {
      for (let y = y0; y < Math.min(h, y0 + rows); y += 1) {
        const wave = Math.sin(y * 0.007) * 2;
        const fall = Math.cos(y * 0.009);
        for (let x = 0; x < w; x += 1) {
          const i = y * w + x;
          const leather = tile[(y % tileSize) * tileSize + (x % tileSize)] ?? 0;
          const f = foil[i] ?? 0;
          const fs = foilSoft[i] ?? 0;
          const gr = grooveSoft[i] ?? 0;
          const st = stitch[i] ?? 0;
          const ss = stitchSoft[i] ?? 0;
          // slow mottling, as real leather has
          const mottle = 0.94 + 0.08 * Math.sin(x * 0.011 + wave) * fall;
          const rim = smooth(Math.min(x, y, w - 1 - x, h - 1 - y) / 12);
          height[i] =
            leather * 0.5 * (1 - fs) * (1 - ss * 0.8) -
            fs * 0.9 -
            gr * 0.55 +
            ss * 0.62 -
            (1 - rim) * 0.5;
          const shade = (0.72 + 0.34 * leather) * mottle * (1 - gr * 0.3);
          const brushed = 0.9 + 0.1 * hash(x >> 1, y, 7);
          const o = i * 4;
          colorImage.data[o] = mix(mix(LEATHER[0] * shade, FOIL[0] * brushed, f), THREAD[0], st);
          colorImage.data[o + 1] = mix(
            mix(LEATHER[1] * shade, FOIL[1] * brushed, f),
            THREAD[1],
            st,
          );
          colorImage.data[o + 2] = mix(
            mix(LEATHER[2] * shade, FOIL[2] * brushed, f),
            THREAD[2],
            st,
          );
          colorImage.data[o + 3] = 255;
          rmImage.data[o + 1] = mix(mix(0.5 + 0.28 * (1 - leather), 0.22, f), 0.6, st) * 255;
          rmImage.data[o + 2] = mix(0.03, 1, f) * 255;
          rmImage.data[o + 3] = 255;
        }
      }
      await idle();
    }
    const normals = canvasOf(w, h);
    const normalImage = normals.g.createImageData(w, h);
    for (let y0 = 0; y0 < h; y0 += rows) {
      normalRows(height, w, h, 3.2, false, normalImage.data, y0, Math.min(h, y0 + rows));
      await idle();
    }
    color.g.putImageData(colorImage, 0, 0);
    rm.g.putImageData(rmImage, 0, 0);
    normals.g.putImageData(normalImage, 0, 0);
    material.map?.dispose();
    material.map = toTexture(color.canvas);
    material.normalMap = toTexture(normals.canvas, false);
    material.roughnessMap = toTexture(rm.canvas, false);
    material.metalnessMap = toTexture(rm.canvas, false);
    material.roughness = 1;
    material.metalness = 1;
    material.needsUpdate = true;
  }
  return { material, relief };
}

function roundedShape(w: number, h: number, r: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return shape;
}

/**
 * A rounded slab with softened edges, centred on z = 0; its two caps (the first material) carry
 * the whole face's 0..1 mapping, its sides the second.
 */
function slab(
  w: number,
  h: number,
  depth: number,
  r: number,
  bevel: number,
  materials: THREE.Material | [THREE.Material, THREE.Material],
) {
  const geometry = new THREE.ExtrudeGeometry(roundedShape(w - 2 * bevel, h - 2 * bevel, r), {
    depth: depth - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 10,
  });
  geometry.translate(0, 0, -(depth - 2 * bevel) / 2);
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const caps = geometry.groups[0];
  if (caps) {
    const index = geometry.index;
    for (let k = caps.start; k < caps.start + caps.count; k += 1) {
      const v = index ? index.getX(k) : k;
      uv.setXY(v, position.getX(v) / w + 0.5, position.getY(v) / h + 0.5);
    }
  }
  return new THREE.Mesh(geometry, materials);
}

/** A cover of the Midnight Passport. */
const coverSlab = (materials: [THREE.Material, THREE.Material]) =>
  slab(W, H, T, 0.05, 0.006, materials);

/** A page that curves down into the gutter at its spine edge (u = 0) and swells a little. */
function curvedPage(w: number, h: number, material: THREE.Material, spineAtLeft = true) {
  const geometry = new THREE.PlaneGeometry(w, h, 48, 1);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const u = position.getX(i) / w + 0.5;
    const fromSpine = spineAtLeft ? u : 1 - u;
    position.setZ(
      i,
      0.006 * Math.max(0, Math.sin(Math.PI * fromSpine)) ** 0.7 -
        0.012 * Math.exp(-fromSpine / 0.025),
    );
  }
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function makePassport() {
  const group = new THREE.Group();
  const { height: tileHeight, material: leather } = leatherTile();
  const { material: face, relief } = coverFace(tileHeight, 256);

  const back = coverSlab([leather, leather]);
  back.position.z = -(PAGES / 2 + T / 2);

  // the spine: a rounded fold of the same leather, joining the covers
  const spineRadius = PAGES / 2 + T / 2;
  const spine = new THREE.Mesh(
    new THREE.CylinderGeometry(spineRadius, spineRadius, H - 0.06, 24, 1, true, Math.PI, Math.PI),
    leather,
  );
  spine.position.x = -W / 2 + 0.02;

  const edges = texture(64, 512, (g, w, h) => {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) {
      g.fillStyle = `rgba(120, 104, 80, ${0.12 + 0.12 * hash(y, 1, 9)})`;
      g.fillRect(0, y, w, 1);
    }
  });
  edges.wrapS = THREE.RepeatWrapping;
  const pages = new THREE.Mesh(
    new RoundedBoxGeometry(BLOCK_W, BLOCK_H, PAGES, 3, 0.02),
    new THREE.MeshStandardMaterial({ map: edges, roughness: 0.95 }),
  );
  pages.position.x = 0.012;

  // the data page: the photo, the hidden details, the machine-readable zone
  const dataPage = curvedPage(
    PAGE_W,
    PAGE_H,
    new THREE.MeshStandardMaterial({
      roughness: 0.9,
      map: texture(900, Math.round(900 * (PAGE_H / PAGE_W)), (g, w, h) => {
        const u = w / 410;
        g.fillStyle = PAPER_HI;
        g.fillRect(0, 0, w, h);
        guilloche(g, w, h, 'rgba(162, 79, 64, 0.08)');
        label(g, 'Midnight Passport', 28 * u, 50 * u, 19 * u, MUTED);
        symbol(g, w - 42 * u, 42 * u, 32 * u, INK);
        roundRect(g, 28 * u, 82 * u, 132 * u, 168 * u, 12 * u);
        g.fillStyle = '#e6dccb';
        g.fill();
        g.fillStyle = '#c9bba3';
        g.beginPath();
        g.arc(94 * u, 146 * u, 30 * u, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.ellipse(94 * u, 232 * u, 48 * u, 36 * u, 0, Math.PI, 0);
        g.fill();
        ['Name', 'Date of birth', 'Document'].forEach((row, i) => {
          const y = 108 * u + i * 54 * u;
          label(g, row, 178 * u, y, 15 * u, MUTED);
          hatch(g, 178 * u, y + 12 * u, w - 236 * u, 18 * u, 'rgba(37, 40, 35, 0.42)');
          lock(g, w - 50 * u, y + 8 * u, 22 * u, INK);
        });
        g.fillStyle = 'rgba(37, 40, 35, 0.12)';
        g.fillRect(28 * u, h - 150 * u, w - 56 * u, 2 * u);
        for (const y of [h - 126 * u, h - 94 * u])
          hatch(g, 28 * u, y, w - 56 * u, 20 * u, 'rgba(37, 40, 35, 0.32)');
        label(g, 'Shown only when you choose', 28 * u, h - 40 * u, 16 * u, TERRACOTTA);
      }),
    }),
  );
  dataPage.position.set(0.012, 0, PAGES / 2 + 0.004);

  // the front cover turns on the spine (its left edge)
  const hinge = new THREE.Group();
  hinge.position.set(-W / 2, 0, PAGES / 2 + T / 2);
  const front = coverSlab([face, leather]);
  front.position.x = W / 2;
  const endpaper = curvedPage(
    PAGE_W,
    PAGE_H,
    new THREE.MeshStandardMaterial({
      roughness: 0.92,
      map: texture(620, Math.round(620 * (PAGE_H / PAGE_W)), (g, w, h) => {
        g.fillStyle = '#efe5d3';
        g.fillRect(0, 0, w, h);
        guilloche(g, w, h, 'rgba(162, 79, 64, 0.16)');
        symbol(g, w / 2, h * 0.44, w * 0.3, 'rgba(162, 79, 64, 0.22)');
        g.textAlign = 'center';
        g.font = `400 ${w * 0.066}px ${SERIF}`;
        g.fillStyle = INK;
        g.fillText('Your identity.', w / 2, h * 0.7);
        g.fillText('Your privacy.', w / 2, h * 0.7 + w * 0.085);
      }),
    }),
    false,
  );
  endpaper.position.set(W / 2 + 0.006, 0, -T / 2 - 0.002);
  endpaper.rotation.y = Math.PI;
  hinge.add(front, endpaper);

  const drop = dropShadow(W * 1.5, H * 1.32, 0.55);
  drop.position.set(0.06, -0.1, -(PAGES / 2 + T) - 0.08);

  group.add(drop, back, spine, pages, dataPage, hinge);
  return { group, hinge, dataPage, relief };
}

/* ------------------------------------------------------------------------------------------- */
/* Paper, the phone, the proof                                                                  */

/** A thin rounded sheet of paper with a printed face and a soft shadow behind it. */
function sheetCard(w: number, h: number, ppu: number, draw: Draw) {
  const group = new THREE.Group();
  const geometry = new THREE.ShapeGeometry(roundedShape(w, h, 0.06), 8);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1)
    uv.setXY(i, position.getX(i) / w + 0.5, position.getY(i) / h + 0.5);
  const face = new THREE.Mesh(
    geometry,
    base(
      new THREE.MeshStandardMaterial({
        map: texture(Math.round(w * ppu), Math.round(h * ppu), draw),
        roughness: 0.86,
      }),
    ),
  );
  const drop = dropShadow(w * 1.3, h * 1.36, 0.42);
  drop.position.set(0.05, -0.09, -0.12);
  group.add(drop, face);
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
  const ppu = 700;
  const group = new THREE.Group();
  const front = sheetCard(w, h, ppu, (g, tw, th) => {
    const u = tw / 528;
    g.fillStyle = PAPER_HI;
    g.fillRect(0, 0, tw, th);
    label(g, 'A seed phrase', 38 * u, 64 * u, 25 * u, TERRACOTTA);
    g.font = `400 ${25 * u}px ${SANS}`;
    g.fillStyle = MUTED;
    g.fillText('12 secret words that open a wallet', 38 * u, 106 * u);
    SEED.forEach((word, i) => {
      const x = 38 * u + (i % 2) * (tw / 2 - 10 * u);
      const y = 186 * u + Math.floor(i / 2) * 70 * u;
      g.font = `600 ${21 * u}px ${SANS}`;
      g.fillStyle = MUTED;
      g.fillText(String(i + 1).padStart(2, '0'), x, y);
      g.font = `400 ${36 * u}px ${SERIF}`;
      g.fillStyle = INK;
      g.fillText(word, x + 42 * u, y);
    });
    g.font = `600 ${23 * u}px ${SANS}`;
    g.fillStyle = TERRACOTTA;
    g.fillText('Lose it, or show it: the money is gone.', 38 * u, th - 42 * u);
  });
  const backFace = sheetCard(w, h, ppu, (g, tw, th) => {
    const u = tw / 528;
    g.fillStyle = PAPER_HI;
    g.fillRect(0, 0, tw, th);
    guilloche(g, tw, th, 'rgba(162, 79, 64, 0.07)');
    label(g, 'Backup', 38 * u, 66 * u, 25 * u, MUTED);
    check(g, 38 * u, 108 * u, 42 * u, TERRACOTTA);
    g.font = `400 ${54 * u}px ${SERIF}`;
    g.fillStyle = INK;
    g.fillText('Recovery', 96 * u, 148 * u);
    g.fillText('is set', 96 * u, 206 * u);
    g.font = `400 ${28 * u}px ${SANS}`;
    g.fillStyle = MUTED;
    [
      'No words to keep.',
      'Restore it on a new phone,',
      'even after losing every',
      'device.',
    ].forEach((line, i) => {
      g.fillText(line, 38 * u, 310 * u + i * 42 * u);
    });
    symbol(g, tw - 92 * u, th - 92 * u, 100 * u, 'rgba(162, 79, 64, 0.5)');
  });
  backFace.rotation.y = Math.PI;
  backFace.position.z = -0.004;
  // two strokes cross the seed phrase out
  const strike = base(new THREE.MeshStandardMaterial({ color: TERRACOTTA, roughness: 0.5 }));
  const strokes = [0.62, -0.62].map((angle) => {
    const pivot = new THREE.Group();
    const bar = new THREE.Mesh(new RoundedBoxGeometry(1.46, 0.05, 0.02, 2, 0.01), strike);
    bar.position.x = 0.73;
    pivot.add(bar);
    pivot.rotation.z = angle;
    pivot.position.set(-0.55, angle > 0 ? -0.42 : 0.42, 0.03);
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
  const frame = slab(
    w,
    h,
    0.1,
    0.15,
    0.02,
    base(new THREE.MeshStandardMaterial({ color: '#3a342d', roughness: 0.3, metalness: 0.7 })),
  );
  const glass = slab(
    w * 0.95,
    h * 0.975,
    0.02,
    0.13,
    0.006,
    base(new THREE.MeshStandardMaterial({ color: '#15130f', roughness: 0.12, metalness: 0.3 })),
  );
  glass.position.z = 0.05;
  const screenMap = (unlocked: boolean) =>
    texture(600, 1260, (g, tw, th) => {
      const u = tw / 430;
      roundRect(g, 0, 0, tw, th, 58 * u);
      const fill = g.createLinearGradient(0, 0, 0, th);
      fill.addColorStop(0, '#2c2722');
      fill.addColorStop(1, '#191714');
      g.fillStyle = fill;
      g.fill();
      g.textAlign = 'center';
      roundRect(g, tw / 2 - 52 * u, 22 * u, 104 * u, 26 * u, 13 * u);
      g.fillStyle = '#0d0c0a';
      g.fill();
      symbol(g, tw / 2, 140 * u, 70 * u, PAPER);
      g.font = `600 ${22 * u}px ${SANS}`;
      g.fillStyle = 'rgba(243, 237, 223, 0.76)';
      g.letterSpacing = `${3 * u}px`;
      g.fillText('MIDNIGHT PASSPORT', tw / 2, 218 * u);
      g.letterSpacing = '0px';
      g.font = `400 ${42 * u}px ${SERIF}`;
      g.fillStyle = PAPER;
      g.fillText(unlocked ? 'Unlocked' : 'Touch to unlock', tw / 2, th - 140 * u);
      g.font = `400 ${25 * u}px ${SANS}`;
      g.fillStyle = 'rgba(243, 237, 223, 0.66)';
      g.fillText(unlocked ? 'with your passkey' : 'Face or fingerprint', tw / 2, th - 96 * u);
    });
  const locked = screenMap(false);
  const open = screenMap(true);
  const screenMat = base(new THREE.MeshBasicMaterial({ map: locked }));
  const screenGeometry = new THREE.ShapeGeometry(roundedShape(w * 0.9, h * 0.94, 0.11), 10);
  const screenPosition = screenGeometry.attributes.position as THREE.BufferAttribute;
  const screenUv = screenGeometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < screenPosition.count; i += 1)
    screenUv.setXY(
      i,
      screenPosition.getX(i) / (w * 0.9) + 0.5,
      screenPosition.getY(i) / (h * 0.94) + 0.5,
    );
  const screen = new THREE.Mesh(screenGeometry, screenMat);
  screen.position.z = 0.062;
  // the fingerprint: open arcs, drawn on as the finger is read
  const print = new THREE.Group();
  const material = base(new THREE.MeshBasicMaterial({ color: EMBER }));
  const shapes = [
    [0.05, 215, 505],
    [0.095, 200, 520],
    [0.14, 225, 500],
    [0.185, 205, 515],
    [0.23, 230, 490],
    [0.275, 215, 455],
  ] as const;
  const arcs = shapes.map(([r, from, to]) => {
    const points: THREE.Vector3[] = [];
    for (let a = from; a <= to; a += 3) {
      const t = (a * Math.PI) / 180;
      points.push(new THREE.Vector3(0.84 * r * Math.sin(t), r * Math.cos(t), 0));
    }
    const arc = tube(new THREE.CatmullRomCurve3(points), 0.0075, 64, material);
    print.add(arc);
    return arc;
  });
  print.position.set(0, -0.04, 0.07);
  const drop = dropShadow(w * 1.4, h * 1.3, 0.5);
  drop.position.set(0.06, -0.12, -0.14);
  group.add(drop, frame, glass, screen, print);
  return {
    group,
    draw(progress: number, unlocked: boolean) {
      arcs.forEach((arc, i) => {
        reveal(arc, progress * 1.4 - i * 0.07);
      });
      material.color.set(unlocked ? PAPER : EMBER);
      screenMat.map = unlocked ? open : locked;
    },
  };
}

/** The proof: a terracotta seal with a check, one unit across. */
function makeProofToken() {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.12, 64),
    base(new THREE.MeshStandardMaterial({ color: TERRACOTTA, roughness: 0.4, metalness: 0.2 })),
  );
  disc.rotation.x = Math.PI / 2;
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.44, 64),
    base(
      new THREE.MeshBasicMaterial({
        map: texture(128, 128, (g) => check(g, 30, 34, 68, PAPER_HI)),
        transparent: true,
      }),
    ),
  );
  face.position.z = 0.062;
  group.add(disc, face);
  return group;
}

/* ------------------------------------------------------------------------------------------- */

type Box = { x: number; y: number; w: number; h: number };

export async function createPassportScene(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
): Promise<PassportScene> {
  await document.fonts.ready;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.92;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = studio;
  scene.environmentIntensity = 0.42;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 7.6);
  scene.add(new THREE.HemisphereLight('#f6e7d4', '#2a1d18', 0.5));
  // a raking key from the upper left, so the relief of the cover catches it
  const key = new THREE.DirectionalLight('#ffe6cc', 2.2);
  key.position.set(-3.4, 3.2, 2.4);
  const rim = new THREE.DirectionalLight(EMBER, 1.2);
  rim.position.set(4, 1.5, -2);
  scene.add(key, rim);

  const passport = makePassport();
  const token = makeProofToken();
  const scan = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 0.035),
    base(
      new THREE.MeshBasicMaterial({
        map: texture(512, 16, (g, w, h) => {
          const glow = g.createLinearGradient(0, 0, w, 0);
          glow.addColorStop(0, 'rgba(224, 142, 124, 0)');
          glow.addColorStop(0.5, 'rgba(224, 142, 124, 1)');
          glow.addColorStop(1, 'rgba(224, 142, 124, 0)');
          g.fillStyle = glow;
          g.fillRect(0, h * 0.3, w, h * 0.4);
        }),
        depthWrite: false,
      }),
    ),
  );
  const sheet = makeSeedSheet();
  const phone = makePhone();
  const threadMaterial = base(new THREE.MeshBasicMaterial({ color: EMBER }), 0.9);
  let threads: THREE.Mesh[] = [];
  scene.add(passport.group, token, scan, sheet.group, phone.group);

  let time = 0;
  let width = 1;
  let height = 1;
  let unit = 1; // world units per CSS pixel at the depth of the slots
  let frame = 0;
  let running = false;
  const boxes = new Map<string, Box>();
  const started = performance.now();
  const elapsed = () => (performance.now() - started) / 1000;

  /** An element's place in the canvas, as laid out (the cards' own animations left out). */
  function layoutRect(element: HTMLElement) {
    const stop = canvas.offsetParent;
    let x = 0;
    let y = 0;
    let node: Element | null = element;
    while (node instanceof HTMLElement && node !== stop) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent;
    }
    if (node === stop)
      return {
        x: x - canvas.offsetLeft,
        y: y - canvas.offsetTop,
        w: element.offsetWidth,
        h: element.offsetHeight,
      };
    const a = element.getBoundingClientRect();
    const b = canvas.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
  }

  function readSlots() {
    boxes.clear();
    for (const element of host.querySelectorAll<HTMLElement>('[data-slot]')) {
      const r = layoutRect(element);
      boxes.set(element.dataset.slot ?? '', {
        x: (r.x + r.w / 2 - width / 2) * unit,
        y: (height / 2 - r.y - r.h / 2) * unit,
        w: r.w * unit,
        h: r.h * unit,
      });
    }
  }
  const box = (name: string): Box => boxes.get(name) ?? { x: 0, y: 0, w: W, h: H };

  /** Threads from the symbol on the closed Midnight Passport to each agent's pass. */
  function buildThreads() {
    for (const thread of threads) {
      scene.remove(thread);
      thread.geometry.dispose();
    }
    const cover = box('cover-5');
    const s = cover.h / H;
    const from = new THREE.Vector3(cover.x + 0.12 * s, cover.y + 0.04 * s, 0.05 * s);
    threads = [0, 1, 2].map((i) => {
      const pass = box(`agent-${i}`);
      const to = new THREE.Vector3(pass.x - pass.w / 2, pass.y, 0);
      const reach = (to.x - from.x) * 0.45;
      const curve = new THREE.CubicBezierCurve3(
        from,
        new THREE.Vector3(from.x + reach, from.y, from.z),
        new THREE.Vector3(to.x - reach, to.y, 0),
        to,
      );
      const thread = tube(curve, 1.1 * unit, 64, threadMaterial);
      scene.add(thread);
      return thread;
    });
  }

  const place = (
    object: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    s: number,
    ry = 0,
    rx = 0,
  ) => {
    object.position.set(x, y, z);
    object.scale.setScalar(s);
    object.rotation.set(rx, ry, 0);
  };
  const point = new THREE.Vector3();

  function pose(t: number, idle: number) {
    const sway = (seed: number) => Math.sin(idle * 0.5 + seed) * 0.035;
    const float = (seed: number, s: number) => Math.sin(idle * 0.8 + seed) * 0.012 * s;

    // The Midnight Passport: rises in closed (1), opens on its data page (2), leaves while the
    // seed phrase and the name play (3, 4), and comes back closed for the agents (5).
    const c1 = box('cover-1');
    const page = box('page');
    const c5 = box('cover-5');
    const s1 = c1.h / H;
    const s2 = page.h / BLOCK_H;
    const s5 = c5.h / H;
    const p2 = local(t, 1);
    const p5 = local(t, 4);
    const toOpen = between(p2, BEATS.ask.open);
    const last = p5 > -0.6;
    const arrive = span(t, PARTS_AT - 0.32, PARTS_AT + 0.04);
    const shown = last ? span(p5, -0.08, 0.06) : arrive * (1 - span(p2, 0.84, 1.0));
    const s = last ? s5 : mix(s1, s2, toOpen);
    const x = last ? c5.x : mix(c1.x, page.x - 0.012 * s2, toOpen);
    const y = last ? c5.y : mix(c1.y, page.y, toOpen);
    place(
      passport.group,
      x,
      y + float(0, s) - (1 - arrive) * 0.4 * s,
      0,
      s,
      mix(-0.2, -0.08, last ? 0 : toOpen) + sway(1),
      -0.05,
    );
    passport.hinge.rotation.y = -(last ? 0 : toOpen) * Math.PI * 0.8;
    fade(passport.group, shown);

    // 2. The hidden details are read; a proof flies from the data page to the app's question.
    const scanK = between(p2, BEATS.ask.scan);
    passport.group.updateMatrixWorld(true);
    point.set(0, mix(0.26, -0.12, scanK) * PAGE_H, 0.03);
    passport.dataPage.localToWorld(point);
    place(scan, point.x, point.y, point.z, PAGE_W * 0.8 * s2, passport.group.rotation.y);
    fade(scan, presence(t, 1) * Math.sin(scanK * Math.PI));

    const proof = box('proof');
    const fly = between(p2, BEATS.ask.fly);
    point.set(0.05 * PAGE_W, 0.05 * PAGE_H, 0.06);
    passport.dataPage.localToWorld(point);
    const zFly = 0.35 + Math.sin(fly * Math.PI) * 0.6;
    const depth = (camera.position.z - zFly) / camera.position.z;
    const toX = (proof.x - proof.w / 2 + proof.h * 0.62) * depth;
    const toY = proof.y * depth;
    const landed = between(p2, BEATS.ask.proven);
    place(
      token,
      mix(point.x, toX, fly),
      mix(point.y, toY, fly) + Math.sin(fly * Math.PI) * 0.35 * s2,
      zFly,
      proof.h * 0.92 * mix(0.6, 1, span(p2, 0.38, 0.44)) * (1 - landed * 0.3),
      fly * Math.PI * 2,
    );
    fade(token, presence(t, 1) * span(p2, 0.38, 0.42) * (1 - landed));

    // 3. No seed phrase: the phrase is crossed out, a fingerprint unlocks the phone, and the
    //    sheet turns over to show the recovery backup.
    const p3 = local(t, 2);
    const three = presence(t, 2);
    const sheetBox = box('sheet');
    const sheetS = sheetBox.h / 1.46;
    const turn = between(p3, BEATS.unlock.turn);
    place(
      sheet.group,
      sheetBox.x,
      sheetBox.y + float(7, sheetS),
      0,
      sheetS * mix(0.94, 1, span(p3, 0, 0.14)),
      0.2 + turn * Math.PI + sway(7) * (1 - turn),
    );
    fade(sheet.group, three);
    const [crossFrom, crossTo] = BEATS.unlock.cross;
    const crossHalf = (crossTo - crossFrom) * 0.6;
    sheet.strokes.forEach((stroke, i) => {
      const from = crossFrom + i * (crossTo - crossFrom - crossHalf);
      const k = span(p3, from, from + crossHalf);
      stroke.scale.set(Math.max(0.001, k), 1, 1);
      stroke.visible = k > 0.001 && turn < 0.5;
    });
    sheet.front.visible = turn < 0.5;
    sheet.back.visible = turn >= 0.5;
    const phoneBox = box('phone');
    const phoneS = phoneBox.h / 1.9;
    place(
      phone.group,
      phoneBox.x,
      phoneBox.y + float(9, phoneS),
      0,
      phoneS * mix(0.94, 1, span(p3, 0, 0.16)),
      -0.22 + sway(9),
    );
    phone.draw(between(p3, BEATS.unlock.print), p3 > BEATS.unlock.unlocked);
    fade(phone.group, three);

    // 5. Agents: each pass is tied back to the Midnight Passport as it comes out.
    const five = presence(t, 4);
    threadMaterial.opacity = five * 0.9;
    threads.forEach((thread, i) => {
      const from = BEATS.agents.first + i * BEATS.agents.gap;
      reveal(thread, span(p5, from - 0.02, from + BEATS.agents.length) * (five > 0.01 ? 1 : 0));
    });
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
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    unit = (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / height;
    readSlots();
    buildThreads();
    if (!running) {
      pose(time, elapsed());
      renderer.render(scene, camera);
    }
  }

  resize();
  performance.mark('passport-scene:ready');
  // the relief comes in while the page is idle; the cover is printed flat until then
  passport
    .relief()
    .then(() => {
      performance.mark('passport-scene:relief');
      if (!running) renderer.render(scene, camera);
    })
    .catch(() => undefined);
  return {
    setTime(t) {
      time = t;
      const active = t > PARTS_AT - 0.45 && t < PARTS_AT + STEPS * STEP + 0.6;
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
          const standard = m as THREE.MeshStandardMaterial;
          standard.map?.dispose();
          standard.normalMap?.dispose();
          standard.roughnessMap?.dispose();
          standard.metalnessMap?.dispose();
          m.dispose();
        }
      });
      studio.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
