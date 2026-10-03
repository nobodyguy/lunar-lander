// Pure functions that turn a force reading into a throttle. Kept free of the
// device and the DOM so the settings panel can preview exactly what the game
// will do with a given pull.

// The curve exponent for "exponential". At 3 the first half of the usable
// force range only reaches ~18% throttle, which leaves room to feather a hover.
const EXPONENTIAL_K = 3;

// Once on, input stays on until the force drops below this share of the
// threshold. With the default 1 kg threshold that is the requested 0.7 kg.
export const RELEASE_RATIO = 0.7;

// A hover point at or below the threshold would need infinite thrust, so the
// throttle it maps to is never allowed under this.
const MIN_HOVER_THROTTLE = 0.03;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const applyCurve = (x, curve) =>
  curve === "exponential"
    ? Math.expm1(EXPONENTIAL_K * x) / Math.expm1(EXPONENTIAL_K)
    : x;

export const getMapping = (settings) => ({
  fmax: settings.get("fmax"),
  hover: settings.get("hover"),
  curve: settings.get("curve"),
  threshold: settings.get("threshold"),
});

// Throttle = (force − threshold) / (Fmax − threshold), then shaped by the curve
export const forceToThrottle = (force, { fmax, threshold, curve }) => {
  const span = Math.max(fmax - threshold, 0.1);
  return applyCurve(clamp((force - threshold) / span, 0, 1), curve);
};

export const hoverForce = ({ fmax, hover }) => (fmax * hover) / 100;

export const hoverThrottle = (mapping) =>
  Math.max(forceToThrottle(hoverForce(mapping), mapping), MIN_HOVER_THROTTLE);

export const isHoverBelowThreshold = (mapping) =>
  hoverForce(mapping) <= mapping.threshold;

export const releaseForce = (threshold) => threshold * RELEASE_RATIO;

// Schmitt trigger: on above the threshold, off below RELEASE_RATIO of it, so a
// force hovering right at the threshold doesn't chatter the engine on and off
export const makeThresholdGate = () => {
  let on = false;

  return {
    update: (force, threshold) => {
      if (on && force < releaseForce(threshold)) on = false;
      else if (!on && force > threshold) on = true;
      return on;
    },
    reset: () => (on = false),
    isOn: () => on,
  };
};
