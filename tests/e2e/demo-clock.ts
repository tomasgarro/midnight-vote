import { test as base, expect } from '@playwright/test';

/**
 * The demo catalogue carries real dates. The four Swiss federal objects are
 * open until 27 November 2026 and the World question until 31 December 2026;
 * the France and Argentina pilots closed in early October. A journey that
 * reads the wall clock changes as those dates pass: main went red on
 * 5 October 2026 because the France pilot had closed the day before.
 *
 * So the demo-mode specs run at one fixed instant, inside the window where the
 * Swiss and World consultations are open. Only Date is pinned; timers,
 * animation frames and the WASM runtime keep running in real time.
 *
 * The showcase and runtime lanes (CICO_E2E_MODE) run against deployed
 * contracts and live services, so they keep the real clock.
 */
export const DEMO_NOW = new Date('2026-10-20T09:00:00Z');

export const test = base.extend({
  page: async ({ page }, use) => {
    if (!process.env.CICO_E2E_MODE) await page.clock.setFixedTime(DEMO_NOW);
    await use(page);
  },
});

export { expect };
