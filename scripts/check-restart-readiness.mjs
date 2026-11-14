import { LIVE_CAPABILITIES, PILOT_GATES, releaseBlockers } from '../polls/dist/index.js';

console.log(
  JSON.stringify(
    {
      pilotReady: false,
      capabilities: LIVE_CAPABILITIES,
      blockers: releaseBlockers(),
      gates: PILOT_GATES,
      note: 'A working demonstration does not satisfy the real-pilot release gates.',
    },
    null,
    2,
  ),
);
process.exitCode = 1;
