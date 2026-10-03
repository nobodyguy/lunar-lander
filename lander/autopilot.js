import { LANDER_HEIGHT } from "../helpers/constants.js";

// A cascaded P-controller for force sensor play, where the player only has
// the main engine. Each loop's output is the next loop's setpoint:
//
//   pad offset ─KP→ target sideways speed ─KV→ target tilt
//              ─KA→ target spin rate ─KR→ steering thruster command (−1…1)
//
// Units are the lander's own: pixels, pixels per frame, degrees and degrees
// per frame, where a frame is INTERVAL ms. Inner loops are several times
// faster than the loop feeding them, which is what keeps a cascade of pure P
// stages from oscillating. Tilt is only useful while the engine burns, so
// the outer two loops are slow and the player sets the pace with the throttle.

// Position → sideways speed. Scaled by the difficulty gain.
const KP = 0.002;
const MAX_SIDEWAYS_SPEED = 1;
// Sideways speed error → tilt (degrees per pixel/frame). Scaled by the gain.
const KV = 150;
// Tilt error → spin rate, and spin rate error → thruster command. These two
// set how crisply the lander holds an attitude and don't change with
// difficulty, so a weak autopilot is slow rather than wobbly.
const KA = 0.03;
const MAX_SPIN_RATE = 0.6;
const KR = 15;

// Below LEVEL_ALTITUDE + LEVEL_SPAN pixels of predicted altitude the allowed
// tilt shrinks linearly, reaching zero at LEVEL_ALTITUDE, so the lander is
// upright for touchdown. The prediction looks LEVEL_LOOKAHEAD frames ahead at
// the current descent rate, so a fast descent levels out earlier.
const LEVEL_ALTITUDE = 12;
const LEVEL_SPAN = 110;
const LEVEL_LOOKAHEAD = 45;

// A new target is only taken once it is this much closer than the current
// one, so the lander doesn't flip-flop when it's midway between two pads.
const RETARGET_RATIO = 0.6;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Signed degrees from upright in (−180, 180]; positive leans right
export const signedTiltDegrees = (angle) => {
  const degrees = ((angle * 180) / Math.PI) % 360;
  return degrees > 180 ? degrees - 360 : degrees <= -180 ? degrees + 360 : degrees;
};

export const makeAutopilot = ({ canvasWidth, getPads, getGroundY }) => {
  let target = null;

  // The world wraps horizontally, so the shortest way to a pad may be across
  // the edge of the screen
  const wrappedOffset = (fromX, toX) => {
    const offset = (((toX - fromX) % canvasWidth) + canvasWidth) % canvasWidth;
    return offset > canvasWidth / 2 ? offset - canvasWidth : offset;
  };

  const padCenter = (pad) => pad.x + pad.width / 2;

  const pickTarget = (x) => {
    const pads = getPads();
    if (pads.length === 0) return null;

    const distanceTo = (pad) => Math.abs(wrappedOffset(x, padCenter(pad)));
    const nearest = pads.reduce((best, pad) =>
      distanceTo(pad) < distanceTo(best) ? pad : best
    );
    const current = target && pads.find((pad) => pad.name === target.name);

    if (!current) return nearest;
    return distanceTo(nearest) < distanceTo(current) * RETARGET_RATIO
      ? nearest
      : current;
  };

  // Returns the steering thruster command, −1 (spin left) to 1 (spin right)
  const update = ({ position, velocity, angle, rotationVelocity }, strength) => {
    target = pickTarget(position.x);
    if (!target) return 0;

    const { maxTilt, gain } = strength;

    const altitude =
      getGroundY(position.x) - (position.y + LANDER_HEIGHT / 2);
    const predictedAltitude =
      altitude - Math.max(velocity.y, 0) * LEVEL_LOOKAHEAD;
    const tiltLimit =
      maxTilt * clamp((predictedAltitude - LEVEL_ALTITUDE) / LEVEL_SPAN, 0, 1);

    const offset = wrappedOffset(position.x, padCenter(target));
    const targetSpeed = clamp(
      KP * gain * offset,
      -MAX_SIDEWAYS_SPEED,
      MAX_SIDEWAYS_SPEED
    );
    const targetTilt = clamp(
      KV * gain * (targetSpeed - velocity.x),
      -tiltLimit,
      tiltLimit
    );
    const targetSpin = clamp(
      KA * (targetTilt - signedTiltDegrees(angle)),
      -MAX_SPIN_RATE,
      MAX_SPIN_RATE
    );

    return clamp(KR * (targetSpin - rotationVelocity), -1, 1);
  };

  return {
    update,
    reset: () => (target = null),
    getTarget: () => target,
  };
};
