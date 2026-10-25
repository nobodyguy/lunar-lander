// A headless model of force sensor play, for tuning and testing the autopilot
// without a browser or a Bluetooth device. The integration step mirrors
// _updateProps in lander/lander.js (one step per INTERVAL frame), and the
// pads are sized the way terrain.js sizes them. The throttle comes from a
// scripted "player" that holds altitude until the lander is over a pad, then
// descends gently — roughly what a person does with the force sensor. It
// sees the lander's speed reactionMs late, like a person would, which is
// what makes gusts and engine cutouts bite.

import { makeAutopilot, signedTiltDegrees } from "../lander/autopilot.js";
import { DIFFICULTIES } from "../helpers/rules.js";
import {
  GRAVITY,
  INTERVAL,
  ROTATION_FUEL_RATE,
  LANDER_WIDTH,
  LANDER_HEIGHT,
} from "../helpers/constants.js";

// Park–Miller, so every run is reproducible from its seed
const makeRandom = (seed) => {
  let state = seed % 2147483647 || 1;
  return () => (state = (state * 16807) % 2147483647) / 2147483647;
};

const ROTATION_ACCELERATION = 0.01;
// lander.js _thrust, the standard engine that fuelCapacity is measured in
const STANDARD_THRUST = 0.012;
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
  const largePad = {
    name: "large",
    x: between(0.55, 0.7) * canvasWidth,
    y: groundY,
    width: padWidth(4),
  };
  const pads = [
    ...(preset.largePad ? [largePad] : []),
    {
      name: "small",
      x: between(0.05, 0.3) * canvasWidth,
      y: groundY,
      width: padWidth(1),
    },
  ];

  const autopilot = makeAutopilot({
    canvasWidth,
    getPads: () => pads,
    getGroundY: () => groundY,
    getGravity: () => gravity,
  });

  // lander.js resetProps
  const thrust = STANDARD_THRUST;
  const { launchScale } = preset;
  const position = {
    x: between(0.33, 0.66) * canvasWidth,
    y: LANDER_HEIGHT * 2,
  };
  const velocity = {
    x: launchScale * between(-thrust, thrust) * (canvasWidth / 10),
    y: between(0, thrust * (canvasWidth / 10)),
  };
  let rotationVelocity = launchScale * between(-0.2, 0.2);
  let angle =
    Math.PI * 2 +
    launchScale * (between(Math.PI * 1.5, Math.PI * 2.5) - Math.PI * 2);

  // Presets are used even when switched off, for the intervals' draws
  const gust = disturbances || DIFFICULTIES.hard.disturbances;
  const cutout = engineCutouts || DIFFICULTIES.hard.engineCutouts;
  let nextGustFrame = between(gust.minIntervalMs, gust.maxIntervalMs) / INTERVAL;
  let gustFramesLeft = 0;
  let gustPush = 0;
  let gustSpin = 0;
  let gusts = 0;
  let cutouts = 0;
  let lowestCutoutAltitude = Infinity;
  let cutoutUntilFrame = 0;
  let nextCutoutFrame =
    between(cutout.minIntervalMs, cutout.maxIntervalMs) / INTERVAL;
  // Tracked but not enforced: the scripted player is slower and so thirstier
  // than a person, so it would run dry where a person wouldn't
  let fuelUsed = 0;
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

    // lander.js _applyDisturbance: a gust is spread evenly over its
    // duration, and stops near the ground
    if (disturbances) {
      if (altitude < gust.minAltitude) gustFramesLeft = 0;
      if (frame >= nextGustFrame) {
        if (altitude >= gust.minAltitude) {
          const sign = () => (random() < 0.5 ? -1 : 1);
          gustFramesLeft = Math.max(1, Math.round(gust.durationMs / INTERVAL));
          gustPush = (sign() * between(0.5, 1) * gust.maxPush) / gustFramesLeft;
          gustSpin = (sign() * between(0.5, 1) * gust.maxSpin) / gustFramesLeft;
          gusts++;
        }
        nextGustFrame =
          frame + between(gust.minIntervalMs, gust.maxIntervalMs) / INTERVAL;
      }
      if (gustFramesLeft > 0) {
        velocity.x += gustPush;
        rotationVelocity += gustSpin;
        gustFramesLeft--;
      }
    }

    // lander.js _applyEngineCutout: due cutouts wait for the engine to fire
    // well clear of the ground
    if (
      engineCutouts &&
      throttle > 0 &&
      frame >= cutoutUntilFrame &&
      frame >= nextCutoutFrame &&
      altitude >= cutout.minAltitude
    ) {
      cutoutUntilFrame =
        frame +
        between(cutout.minDurationMs, cutout.maxDurationMs) / INTERVAL;
      nextCutoutFrame =
        cutoutUntilFrame +
        between(cutout.minIntervalMs, cutout.maxIntervalMs) / INTERVAL;
      cutouts++;
      lowestCutoutAltitude = Math.min(lowestCutoutAltitude, altitude);
    }

    const thrust = frame < cutoutUntilFrame ? 0 : maxThrust * throttle;
    // lander.js _burnFuel
    fuelUsed +=
      (thrust / STANDARD_THRUST + Math.abs(command) * ROTATION_FUEL_RATE) *
      INTERVAL;

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
        fuelUsed: fuelUsed / preset.fuelCapacity,
      };
    }
  }

  return {
    landed: false,
    timedOut: true,
    gusts,
    cutouts,
    lowestCutoutAltitude,
    fuelUsed: fuelUsed / preset.fuelCapacity,
  };
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
    // Share of the tank, 0 when the tank is unlimited
    averageFuelUsed: average(landed.map((r) => r.fuelUsed)),
    wouldRunDry: results.filter((r) => r.fuelUsed > 1).length,
    failures: results.filter((r) => !r.landed),
  };
};
