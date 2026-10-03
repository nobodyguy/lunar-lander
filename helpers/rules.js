import {
  GRAVITY,
  CRASH_VELOCITY,
  CRASH_ANGLE,
  FUEL_CAPACITY,
} from "./constants.js";

// Force sensor play has one difficulty switch that sets everything below.
// Hard matches the physics and tolerances of the standard game; the force
// sensor's autopilot is what makes it playable at all with a single input.
//
// gravityScale  multiplies GRAVITY
// fuelCapacity  ms of burn at the standard engine thrust; Infinity is no limit
// padScale      multiplies the landing pad width
// crashVelocity / crashAngle  the touchdown tolerances
// autopilot     maxTilt in degrees, gain multiplies the position and velocity
//               loops (the attitude loops stay fixed so the lander never wobbles)
// disturbances  random pushes in position and rotation
// engineCutouts brief random failures of the main engine
export const DIFFICULTIES = {
  easy: {
    gravityScale: 0.8,
    fuelCapacity: Infinity,
    padScale: 2,
    crashVelocity: CRASH_VELOCITY * 1.5,
    crashAngle: 16,
    autopilot: { maxTilt: 30, gain: 1 },
    disturbances: false,
    engineCutouts: false,
  },
  medium: {
    gravityScale: 1,
    fuelCapacity: FUEL_CAPACITY * 1.5,
    padScale: 1.5,
    crashVelocity: CRASH_VELOCITY * 1.25,
    crashAngle: 13,
    autopilot: { maxTilt: 22, gain: 0.8 },
    disturbances: false,
    engineCutouts: false,
  },
  hard: {
    gravityScale: 1.2,
    fuelCapacity: FUEL_CAPACITY,
    padScale: 1,
    crashVelocity: CRASH_VELOCITY,
    crashAngle: CRASH_ANGLE,
    autopilot: { maxTilt: 15, gain: 0.6 },
    disturbances: true,
    engineCutouts: true,
  },
};

// The random pushes on hard. Each one kicks the sideways speed (pixels per
// frame) and the spin rate (degrees per frame) by a random amount up to these,
// in a random direction. None come close to the ground, where the autopilot
// has already levelled out and could not correct them.
export const DISTURBANCE = {
  minIntervalMs: 4000,
  maxIntervalMs: 8000,
  maxPush: 0.3,
  maxSpin: 0.35,
  minAltitude: 100,
};

// Brief main engine failures on hard. One comes due every interval but waits
// for the engine to be firing, so it's always felt. Never close to the
// ground: a 0.5 s cutout adds ~0.25 px/frame of descent (the crash limit is
// 0.6), which a firm pull wins back within a fraction of a second, but only
// with height to spare.
export const ENGINE_CUTOUT = {
  minIntervalMs: 7000,
  maxIntervalMs: 14000,
  minDurationMs: 300,
  maxDurationMs: 700,
  minAltitude: 150,
};

export const DIFFICULTY_DESCRIPTIONS = {
  easy: "Low gravity, unlimited fuel, wide pads and a forgiving touchdown. The autopilot steers hard.",
  medium: "Normal gravity, a large tank, bigger pads and a little extra touchdown tolerance.",
  hard: "Heavy gravity, a standard tank, standard pads and tolerances, a gentle autopilot, sudden gusts and brief engine failures.",
};

// Read every frame by the lander, so the object is rebuilt only when one of
// the settings it depends on changes
export const makeRules = (settings) => {
  let cached = null;

  settings.subscribe((key) => {
    if (key === "controls" || key === "difficulty" || key === "fuel") {
      cached = null;
    }
  });

  const build = () => {
    if (settings.get("controls") !== "force") {
      return {
        gravity: GRAVITY,
        crashVelocity: CRASH_VELOCITY,
        crashAngle: CRASH_ANGLE,
        fuelCapacity:
          settings.get("fuel") === "limited" ? FUEL_CAPACITY : Infinity,
        padScale: 1,
        autopilot: null,
        disturbances: false,
        engineCutouts: false,
      };
    }

    const { gravityScale, ...preset } =
      DIFFICULTIES[settings.get("difficulty")];
    return { ...preset, gravity: GRAVITY * gravityScale };
  };

  return () => (cached ??= build());
};
