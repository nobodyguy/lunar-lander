// A headless model of force sensor play, for tuning and testing the autopilot
// without a browser or a Bluetooth device. The integration step mirrors
// _updateProps in lander/lander.js (one step per INTERVAL frame), and the
// pads are sized the way terrain.js sizes them. The throttle comes from a
// scripted "player" that holds altitude until the lander is over a pad, then
// descends gently — roughly what a person does with the force sensor. It
// sees the lander's speed reactionMs late, like a person would, which is
// what makes gusts and engine cutouts bite.

import { makeAutopilot, signedTiltDegrees } from "../lander/autopilot.js";
import { DIFFICULTIES, DISTURBANCE, ENGINE_CUTOUT } from "../helpers/rules.js";
import {
  GRAVITY,
  INTERVAL,
  LANDER_WIDTH,
  LANDER_HEIGHT,
} from "../helpers/constants.js";

// Park–Miller, so every run is reproducible from its seed
const makeRandom = (seed) => {
  let state = seed % 2147483647 || 1;
  return () => (state = (state * 16807) % 2147483647) / 2147483647;
};

const ROTATION_ACCELERATION = 0.01;
const MAX_FRAMES = Math.round(120000 / INTERVAL);

export const simulateLanding = ({
  difficulty = "medium",
  seed = 1,
  canvasWidth = 1280,
  canvasHeight = 800,
  hoverThrottle = 0.3,
  disturbances = DIFFICULTIES[difficulty].disturbances,
  engineCutouts = DIFFICULTIES[difficulty].engineCutouts,
  reactionMs = 250,
} = {}) => {
  const random = makeRandom(seed);
  const between = (min, max) => min + random() * (max - min);
  const preset = DIFFICULTIES[difficulty];
  const gravity = GRAVITY * preset.gravityScale;
  const maxThrust = gravity / hoverThrottle;
  const groundY = canvasHeight * 0.8;

  // terrain.js: pads are whole terrain segments, at least 1.5 landers wide
  // before the difficulty's scale, and no wider than a third of the screen
  const numPoints = Math.max(Math.round(canvasWidth / 60), 20);
  const segment = canvasWidth / numPoints;
  const minWidthInPoints = Math.ceil((LANDER_WIDTH * 1.5) / segment);
  const padWidth = (widthUnit) =>
    Math.min(
      Math.max(1, Math.round(minWidthInPoints * widthUnit * preset.padScale)),
      Math.floor(numPoints / 3) - 1
    ) * segment;
  const pads = [
    {
      name: "small",
      x: between(0.05, 0.3) * canvasWidth,
      y: groundY,
      width: padWidth(1),
    },
    {
      name: "large",
      x: between(0.55, 0.7) * canvasWidth,
      y: groundY,
      width: padWidth(4),
    },
  ];

  const autopilot = makeAutopilot({
    canvasWidth,
    getPads: () => pads,
    getGroundY: () => groundY,
    getGravity: () => gravity,
  });

  // lander.js resetProps
  const thrust = 0.012;
  const position = {
    x: between(0.33, 0.66) * canvasWidth,
    y: LANDER_HEIGHT * 2,
  };
  const velocity = {
    x: between(-thrust, thrust) * (canvasWidth / 10),
    y: between(0, thrust * (canvasWidth / 10)),
  };
  let rotationVelocity = between(-0.2, 0.2);
  let angle = between(Math.PI * 1.5, Math.PI * 2.5);

  let nextGustFrame = between(
    DISTURBANCE.minIntervalMs,
    DISTURBANCE.maxIntervalMs
  ) / INTERVAL;
  let gusts = 0;
  let cutouts = 0;
  let lowestCutoutAltitude = Infinity;
  let cutoutUntilFrame = 0;
  let nextCutoutFrame =
    between(ENGINE_CUTOUT.minIntervalMs, ENGINE_CUTOUT.maxIntervalMs) /
    INTERVAL;
  const reactionFrames = Math.round(reactionMs / INTERVAL);
  const seenDescent = [];
  let maxTiltAfterRecovery = 0;

  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    const altitude = groundY - (position.y + LANDER_HEIGHT / 2);
    const command = autopilot.update(
      { position, velocity, angle, rotationVelocity },
      preset.autopilot
    );

    // The scripted player: climb back to ~250px if low and not yet over the
    // target, otherwise descend at a rate that slows near the ground
    const target = autopilot.getTarget();
    const overPad =
      Math.abs(target.x + target.width / 2 - position.x) <
      target.width / 2 - LANDER_WIDTH / 2;
    const targetDescent = overPad
      ? Math.min(0.45, Math.max(0.12, altitude / 300))
      : altitude > 250
      ? 0.3
      : -0.2;
    seenDescent.push(velocity.y);
    const lateDescent = seenDescent[Math.max(0, seenDescent.length - 1 - reactionFrames)];
    const wantedAcceleration = gravity + 0.03 * (lateDescent - targetDescent);
    const throttle = Math.min(
      1,
      Math.max(0, wantedAcceleration / Math.max(Math.cos(angle), 0.3) / maxThrust)
    );

    if (disturbances && frame >= nextGustFrame) {
      if (altitude > DISTURBANCE.minAltitude) {
        const sign = () => (random() < 0.5 ? -1 : 1);
        velocity.x += sign() * between(0.5, 1) * DISTURBANCE.maxPush;
        rotationVelocity += sign() * between(0.5, 1) * DISTURBANCE.maxSpin;
        gusts++;
      }
      nextGustFrame =
        frame +
        between(DISTURBANCE.minIntervalMs, DISTURBANCE.maxIntervalMs) /
          INTERVAL;
    }

    // lander.js _applyEngineCutout: due cutouts wait for the engine to fire
    // well clear of the ground
    if (
      engineCutouts &&
      throttle > 0 &&
      frame >= cutoutUntilFrame &&
      frame >= nextCutoutFrame &&
      altitude >= ENGINE_CUTOUT.minAltitude
    ) {
      cutoutUntilFrame =
        frame +
        between(ENGINE_CUTOUT.minDurationMs, ENGINE_CUTOUT.maxDurationMs) /
          INTERVAL;
      nextCutoutFrame =
        cutoutUntilFrame +
        between(ENGINE_CUTOUT.minIntervalMs, ENGINE_CUTOUT.maxIntervalMs) /
          INTERVAL;
      cutouts++;
      lowestCutoutAltitude = Math.min(lowestCutoutAltitude, altitude);
    }
    const thrust = frame < cutoutUntilFrame ? 0 : maxThrust * throttle;

    // lander.js _updateProps with deltaTimeMultiplier = 1
    position.y += velocity.y;
    rotationVelocity += ROTATION_ACCELERATION * command;
    position.x = (((position.x + velocity.x) % canvasWidth) + canvasWidth) % canvasWidth;
    angle += (Math.PI / 180) * rotationVelocity;
    velocity.y += gravity;
    velocity.x += thrust * Math.sin(angle);
    velocity.y -= thrust * Math.cos(angle);

    // The first two seconds are spent righting the random starting attitude
    if (frame * INTERVAL > 2000) {
      maxTiltAfterRecovery = Math.max(
        maxTiltAfterRecovery,
        Math.abs(signedTiltDegrees(angle))
      );
    }

    if (position.y + LANDER_HEIGHT / 2 >= groundY) {
      const speed = Math.hypot(velocity.x, velocity.y);
      const tilt = Math.abs(signedTiltDegrees(angle));
      const onPad = pads.some(
        ({ x, width }) =>
          position.x - LANDER_WIDTH / 2 >= x &&
          position.x + LANDER_WIDTH / 2 <= x + width
      );
      return {
        landed: onPad && speed < preset.crashVelocity && tilt < preset.crashAngle,
        onPad,
        speed,
        tilt,
        seconds: (frame * INTERVAL) / 1000,
        maxTiltAfterRecovery,
        gusts,
        cutouts,
        lowestCutoutAltitude,
      };
    }
  }

  return { landed: false, timedOut: true, gusts, cutouts };
};

export const summarize = (difficulty, runs = 50, options = {}) => {
  const results = Array.from({ length: runs }, (_, index) =>
    simulateLanding({ difficulty, seed: (index + 1) * 7919, ...options })
  );
  const landed = results.filter((r) => r.landed);
  const average = (values) =>
    values.reduce((sum, v) => sum + v, 0) / Math.max(values.length, 1);

  return {
    difficulty,
    runs,
    landed: landed.length,
    timedOut: results.filter((r) => r.timedOut).length,
    averageSeconds: average(landed.map((r) => r.seconds)),
    averageSpeed: average(landed.map((r) => r.speed)),
    worstTilt: Math.max(0, ...results.map((r) => r.maxTiltAfterRecovery ?? 0)),
    cutouts: results.reduce((sum, r) => sum + r.cutouts, 0),
    failures: results.filter((r) => !r.landed),
  };
};
