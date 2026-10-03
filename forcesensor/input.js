import {
  getMapping,
  forceToThrottle,
  hoverThrottle,
  makeThresholdGate,
} from "./mapping.js";

// Sits between the sensor and the game: applies the player's mapping and the
// threshold hysteresis, and announces each fresh pull so a pull can stand in
// for a button press (Play Again).
export const makeForceInput = (sensor, settings) => {
  const gate = makeThresholdGate();
  const pressListeners = new Set();

  sensor.onSample((force) => {
    const wasOn = gate.isOn();
    if (gate.update(force, settings.get("threshold")) && !wasOn) {
      pressListeners.forEach((listener) => listener());
    }
  });

  // A dropped stream stops sending samples, so the gate is also checked on
  // read; otherwise it would stay latched on with the last force it saw
  const isActive = () => {
    if (!sensor.isStreaming()) gate.reset();
    return gate.isOn();
  };

  return {
    isActive,
    getForce: sensor.getForce,
    getThrottle: () =>
      isActive() ? forceToThrottle(sensor.getForce(), getMapping(settings)) : 0,
    getHoverThrottle: () => hoverThrottle(getMapping(settings)),
    isReady: () => settings.get("controls") === "force" && sensor.isStreaming(),
    // Only fires while force controls are selected and the sensor is live
    onPress: (listener) => {
      const guarded = () => {
        if (settings.get("controls") === "force") listener();
      };
      pressListeners.add(guarded);
      return () => pressListeners.delete(guarded);
    },
  };
};
