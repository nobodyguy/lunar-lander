import { makeAutopilot } from "./autopilot.js";

// The force sensor's stand-in for makeControls. Same attach/detach shape, so
// index.js can swap one for the other. The pull sets the main engine's thrust
// every frame; the autopilot flies the steering thrusters.
export const makeForceControls = (state, lander, audioManager, forceInput) => {
  const CTX = state.get("CTX");
  const canvasWidth = state.get("canvasWidth");
  const canvasHeight = state.get("canvasHeight");
  const rules = state.get("rules");
  const terrain = state.get("terrain");

  const autopilot = makeAutopilot({
    canvasWidth,
    getPads: () => terrain.getLandingData().landingSurfaces,
    getGroundY: (x) => terrain.getGroundHeightAtX(x),
  });

  let attached = false;
  let engineSoundOn = false;

  const stopEngine = () => {
    lander.engineOff();
    if (engineSoundOn) audioManager.stopEngineSound();
    engineSoundOn = false;
  };

  const attachEventListeners = () => {
    attached = true;
    lander.setAutopilot(autopilot);
  };

  const detachEventListeners = () => {
    attached = false;
    stopEngine();
    lander.setAutopilot(null);
    lander.resetEngineThrust();
  };

  // Thrust is scaled so the hover point exactly cancels gravity, whatever
  // the difficulty's gravity and the player's mapping
  const maxThrust = () => rules().gravity / forceInput.getHoverThrottle();

  const update = () => {
    if (!attached) return;

    const max = maxThrust();
    lander.setEngineThrust(forceInput.getThrottle() * max, max);

    if (forceInput.isActive()) {
      // false means the tank is empty. The engine stays on through a
      // cutout, which only silences it.
      const running = lander.engineOn() !== false && !lander.isEngineCutOut();
      if (running && !engineSoundOn) {
        audioManager.playEngineSound();
        engineSoundOn = true;
      } else if (!running && engineSoundOn) {
        audioManager.stopEngineSound();
        engineSoundOn = false;
      }
    } else {
      stopEngine();
    }
  };

  // A vertical gauge on the left edge: the fill is the throttle, the green
  // tick is the hover point. Lets the player see how hard to pull without
  // looking away from the lander for long.
  const drawThrottleGauge = () => {
    if (!attached) return;

    const height = Math.min(220, canvasHeight * 0.32);
    const width = 8;
    const x = 18;
    const top = (canvasHeight - height) / 2;
    const throttle = forceInput.getThrottle();
    const hover = forceInput.getHoverThrottle();

    CTX.save();
    CTX.fillStyle = "rgba(255, 255, 255, 0.12)";
    CTX.fillRect(x, top, width, height);
    CTX.fillStyle = lander.isEngineCutOut()
      ? "rgb(255, 60, 60)"
      : forceInput.isActive()
      ? "rgba(255, 255, 255, 0.85)"
      : "rgba(255, 255, 255, 0.35)";
    CTX.fillRect(x, top + height * (1 - throttle), width, height * throttle);

    const hoverY = top + height * (1 - hover);
    CTX.strokeStyle = "rgb(0, 255, 0)";
    CTX.lineWidth = 2;
    CTX.beginPath();
    CTX.moveTo(x - 4, hoverY);
    CTX.lineTo(x + width + 4, hoverY);
    CTX.stroke();

    CTX.fillStyle = state.get("theme").infoFontColor;
    CTX.font = "400 10px -apple-system, BlinkMacSystemFont, sans-serif";
    CTX.textAlign = "center";
    CTX.fillText(
      `${forceInput.getForce().toFixed(1)} kg`,
      x + width / 2,
      top - 8
    );
    CTX.fillText("THRUST", x + width / 2, top + height + 16);
    CTX.restore();
  };

  // A small chevron over the pad the autopilot is steering for. Drawn in
  // terrain coordinates, so call it where the terrain offset is applied.
  const drawTargetMarker = (timeSinceStart) => {
    if (!attached) return;
    const target = lander.getAutopilotTarget();
    if (!target) return;

    const centerX = target.x + target.width / 2;
    const bob = Math.sin(timeSinceStart / 250) * 3;
    const tipY = target.y - 30 + bob;

    CTX.save();
    CTX.fillStyle = "rgba(0, 255, 0, 0.8)";
    CTX.beginPath();
    CTX.moveTo(centerX - 6, tipY - 8);
    CTX.lineTo(centerX + 6, tipY - 8);
    CTX.lineTo(centerX, tipY);
    CTX.closePath();
    CTX.fill();
    CTX.restore();
  };

  return {
    attachEventListeners,
    detachEventListeners,
    update,
    drawThrottleGauge,
    drawTargetMarker,
  };
};
