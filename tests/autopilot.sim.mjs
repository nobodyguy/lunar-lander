// Prints how the autopilot fares on each difficulty, on a desktop-sized and a
// phone-sized canvas. Run with `npm run sim`, or `npm run sim -- 200` for more
// runs per row.

import { summarize } from "./landersim.mjs";

const runs = Number(process.argv[2]) || 50;
const screens = {
  desktop: { canvasWidth: 1280, canvasHeight: 800 },
  phone: { canvasWidth: 420, canvasHeight: 860 },
};

const rows = [];
const variants = [
  ["easy", {}],
  ["medium", {}],
  ["hard", {}],
  ["hard, no cutouts", { engineCutouts: false }],
];
for (const [screen, size] of Object.entries(screens)) {
  for (const [label, options] of variants) {
    const difficulty = label.split(",")[0];
    const s = summarize(difficulty, runs, { ...size, ...options });
    rows.push({
      screen,
      difficulty: label,
      landed: `${s.landed}/${s.runs}`,
      "timed out": s.timedOut,
      "avg time (s)": s.averageSeconds.toFixed(1),
      "avg speed": s.averageSpeed.toFixed(2),
      "worst tilt (°)": s.worstTilt.toFixed(1),
      cutouts: s.cutouts,
    });
  }
}

console.table(rows);
