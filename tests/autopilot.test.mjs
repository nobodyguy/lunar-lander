import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAutopilot, signedTiltDegrees } from "../lander/autopilot.js";
import { DIFFICULTIES, ENGINE_CUTOUT } from "../helpers/rules.js";
import { GRAVITY, LANDER_HEIGHT } from "../helpers/constants.js";
import { simulateLanding, summarize } from "./landersim.mjs";

const RUNS = 20;
const getGravity = () => GRAVITY * DIFFICULTIES.easy.gravityScale;

test("signed tilt wraps to (−180, 180]", () => {
  assert.equal(signedTiltDegrees(0), 0);
  assert.ok(Math.abs(signedTiltDegrees(Math.PI * 2 + 0.1) - 5.7296) < 1e-3);
  assert.ok(Math.abs(signedTiltDegrees(Math.PI * 2 - 0.1) + 5.7296) < 1e-3);
  assert.ok(Math.abs(signedTiltDegrees(-0.1) + 5.7296) < 1e-3);
});

test("steers toward the pad across the screen edge when that is shorter", () => {
  const autopilot = makeAutopilot({
    canvasWidth: 1000,
    getPads: () => [{ name: "pad", x: 960, y: 800, width: 60 }],
    getGroundY: () => 800,
    getGravity,
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
    getPads: () => [{ name: "pad", x: 800, y: 800, width: 60 }],
    getGroundY: () => 800,
    getGravity,
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

test("targets the pad the lander is coasting toward", () => {
  const pads = [
    { name: "behind", x: 520, y: 800, width: 60 },
    { name: "ahead", x: 70, y: 800, width: 60 },
  ];
  const makeOne = () =>
    makeAutopilot({
      canvasWidth: 1000,
      getPads: () => pads,
      getGroundY: () => 800,
      getGravity,
    });
  const moving = (speed) => ({
    position: { x: 450, y: 100 },
    velocity: { x: speed, y: 0 },
    angle: 0,
    rotationVelocity: 0,
  });

  // At rest the pad 100px to the right is nearest
  const still = makeOne();
  still.update(moving(0), DIFFICULTIES.easy.autopilot);
  assert.equal(still.getTarget().name, "behind");

  // Drifting left, it would only stop ~200px on, near the pad to the left
  const coasting = makeOne();
  coasting.update(moving(-0.8), DIFFICULTIES.easy.autopilot);
  assert.equal(coasting.getTarget().name, "ahead");
});

test("keeps steering low over a ridge above a sunken pad", () => {
  // A ridge at y = 700 everywhere but the pad, which sits 150px lower
  const autopilot = makeAutopilot({
    canvasWidth: 1000,
    getPads: () => [{ name: "pad", x: 470, y: 850, width: 60 }],
    getGroundY: (x) => (x >= 470 && x <= 530 ? 850 : 700),
    getGravity,
  });
  // 10px above the ridge, still and upright, with the pad off to the right.
  // Measured from the ridge it would have no tilt left; measured from the
  // pad it leans right toward it.
  const overRidge = {
    position: { x: 300, y: 700 - 10 - LANDER_HEIGHT / 2 },
    velocity: { x: 0, y: 0 },
    angle: 0,
    rotationVelocity: 0,
  };
  assert.ok(autopilot.update(overRidge, DIFFICULTIES.hard.autopilot) > 0);
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
  for (let seed = 1; seed <= 20; seed++) {
    const result = simulateLanding({ difficulty: "hard", seed });
    cutouts += result.cutouts;
    if (result.cutouts > 0) {
      assert.ok(result.lowestCutoutAltitude >= ENGINE_CUTOUT.minAltitude);
    }
  }
  assert.ok(cutouts >= 10, `only ${cutouts} cutouts in 20 hard runs`);
  assert.equal(simulateLanding({ difficulty: "medium", seed: 1 }).cutouts, 0);
});
