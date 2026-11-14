import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const landing = join(here, '..', 'components', 'landing');

/** The stylesheets of the two printed pages: the landing page and the documentation page. */
function printedStylesheets(): { name: string; css: string }[] {
  const sheets = readdirSync(landing)
    .filter((file) => file.endsWith('.css'))
    .map((file) => ({ name: file, css: readFileSync(join(landing, file), 'utf8') }));
  sheets.push({
    name: 'docs-page.css',
    css: readFileSync(join(here, '..', 'views', 'docs-page.css'), 'utf8'),
  });
  return sheets;
}

function hueAndSaturation(hex: string): { hue: number; saturation: number } {
  const digits = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;
  if (spread === 0) return { hue: 0, saturation: 0 };
  const lightness = (max + min) / 2;
  const saturation = spread / (1 - Math.abs(2 * lightness - 1));
  const sector =
    max === r ? ((g - b) / spread) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
  return { hue: (sector * 60 + 360) % 360, saturation };
}

describe('the printed pages', () => {
  const sheets = printedStylesheets();

  it('are set in the two faces of the brand and in no other', () => {
    expect(sheets.length).toBeGreaterThan(5);
    for (const { name, css } of sheets) {
      expect(css, name).not.toMatch(/Outfit|Fraunces|Landing Editorial|Encode Sans/u);
      const families = [...css.matchAll(/font-family:\s*([^;]+);/gu)].map((match) => match[1]);
      for (const family of families) {
        expect(family, `${name}: ${family}`).toMatch(
          /var\(--font-(?:display|body)\)|inherit|Georgia|monospace/u,
        );
      }
    }
  });

  it('carry no blue or purple: terracotta is the only accent', () => {
    // The night inside the passport too: it is the same Alps at dusk, in the page's own colours.
    for (const { name, css } of sheets) {
      for (const match of css.matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/gu)) {
        const { hue, saturation } = hueAndSaturation(match[1] as string);
        const cool = hue >= 170 && hue <= 345;
        expect(cool && saturation > 0.12, `${name}: ${match[0]}`).toBe(false);
      }
    }
  });

  it('keep their paper in the dark theme, because they restate the light tokens', () => {
    for (const file of ['landing.css', 'docs-page.css']) {
      const css = sheets.find((sheet) => sheet.name === file)?.css ?? '';
      expect(css, file).toMatch(/--ground:\s*#f3eddf;/u);
      expect(css, file).toMatch(/--ink:\s*#252823;/u);
      expect(css, file).toMatch(/--accent:\s*#a24f40;/u);
      expect(css, file).toMatch(/color-scheme:\s*light;/u);
    }
  });
});
