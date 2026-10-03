import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAutopilot, signedTiltDegrees } from "../lander/autopilot.js";
import { DIFFICULTIES, ENGINE_CUTOUT } from "../helpers/rules.js";
import { simulateLanding, summarize } from "./landersim.mjs";

const RUNS = 20;

test("signed tilt wraps to (−180, 180]", () => {
  assert.equal(signedTiltDegrees(0), 0);
  assert.ok(Math.abs(signedTiltDegrees(Math.PI * 2 + 0.1) - 5.7296) < 1e-3);
  assert.ok(Math.abs(signedTiltDegrees(Math.PI * 2 - 0.1) + 5.7296) < 1e-3);
  assert.ok(Math.abs(signedTiltDegrees(-0.1) + 5.7296) < 1e-3);
});

test("steers toward the pad across the screen edge when that is shorter", () => {
  const autopilot = makeAutopilot({
    canvasWidth: 1000,
    getPads: () => [{ name: "pad", x: 960, width: 60 }],
    getGroundY: () => 800,
  });
  const snapshot = (rotationVelocity) => ({
    position: { x: 20, y: 100 },
    velocity: { x: 0, y: 0 },
    angle: 0,
    rotationVelocity,
  });
  // The pad centre wraps to x = −10, so the lander should start leaning left
  assert.ok(autopilot.update(snapshot(0), DIFFICULTIES.easy.autopilot) < 0);
});

test("holds the lander upright close to the ground", () => {
  const autopilot = makeAutopilot({
    canvasWidth: 1000,
    getPads: () => [{ name: "pad", x: 800, width: 60 }],
    getGroundY: () => 800,
  });
  // Far from the pad but nearly touching down: no new tilt is commanded,
  // only spin that rights a lean
  const lowAndLeaning = {
    position: { x: 100, y: 770 },
    velocity: { x: 0, y: 0.2 },
    angle: (5 * Math.PI) / 180,
    rotationVelocity: 0,
  };
  assert.ok(autopilot.update(lowAndLeaning, DIFFICULTIES.easy.autopilot) < 0);
});

for (const [difficulty, minimum] of [
  ["easy", RUNS],
  ["medium", RUNS],
  ["hard", Math.ceil(RUNS * 0.8)],
]) {
  test(`lands on a pad on ${difficulty} with a steady player`, () => {
    const result = summarize(difficulty, RUNS);
    assert.ok(
      result.landed >= minimum,
      `${result.landed}/${RUNS} landed: ${JSON.stringify(result.failures[0])}`
    );
  });
}

test("never tilts past the difficulty's limit without disturbances", () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const { maxTilt } = DIFFICULTIES[difficulty].autopilot;
    for (let seed = 1; seed <= 10; seed++) {
      const result = simulateLanding({ difficulty, seed, disturbances: false });
      assert.ok(
        result.maxTiltAfterRecovery <= maxTilt + 0.5,
        `${difficulty} seed ${seed} reached ${result.maxTiltAfterRecovery}°`
      );
    }
  }
});

test("touches down nearly level", () => {
  for (const difficulty of ["easy", "medium", "hard"]) {
    for (let seed = 1; seed <= 10; seed++) {
      const result = simulateLanding({ difficulty, seed });
      if (result.timedOut) continue;
      assert.ok(result.tilt < 3, `${difficulty} seed ${seed}: ${result.tilt}°`);
    }
  }
});

test("engine cutouts happen on hard, never near the ground", () => {
  let cutouts = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const result = simulateLanding({ difficulty: "hard", seed });
    cutouts += result.cutouts;
    if (result.cutouts > 0) {
      assert.ok(result.lowestCutoutAltitude >= ENGINE_CUTOUT.minAltitude);
    }
  }
  assert.ok(cutouts >= 10, `only ${cutouts} cutouts in 10 hard runs`);
  assert.equal(simulateLanding({ difficulty: "medium", seed: 1 }).cutouts, 0);
});
