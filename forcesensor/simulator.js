// A stand-in for a Bluetooth sensor, for trying force controls without one.
// Listed as a device only when the page is opened with ?sensor-sim.
//
// Hold the up arrow (or W) to pull harder, let go to ease off. Scripts can
// set window.simulatedForce to a number of kg to override the keys.

const SAMPLE_MS = 1000 / 80;
const RAMP_KG_PER_S = 25;
const MAX_KG = 60;

export const isSimulatorEnabled = () =>
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("sensor-sim");

export class SimulatedSensor {
  usesHardwareTare = true;
  #connected = false;
  #timer = null;
  #force = 0;
  #offset = 0;
  #pulling = false;
  #notify = () => {};

  #onKey = (event) => {
    if (event.target.closest?.("input, select")) return;
    if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") {
      this.#pulling = event.type === "keydown";
    }
  };

  notify(callback) {
    this.#notify = callback;
  }

  async connect(onSuccess) {
    this.#connected = true;
    document.addEventListener("keydown", this.#onKey);
    document.addEventListener("keyup", this.#onKey);
    await onSuccess();
  }

  async stream() {
    clearInterval(this.#timer);
    this.#timer = setInterval(() => {
      const step = (RAMP_KG_PER_S * SAMPLE_MS) / 1000;
      this.#force = Math.min(
        MAX_KG,
        Math.max(0, this.#force + (this.#pulling ? step : -step * 2))
      );
      const force =
        typeof window.simulatedForce === "number"
          ? window.simulatedForce
          : this.#force;
      this.#notify({ current: force - this.#offset, unit: "kg" });
    }, SAMPLE_MS);
  }

  async stop() {
    clearInterval(this.#timer);
  }

  async battery() {
    return "3980";
  }

  tare() {
    this.#offset =
      typeof window.simulatedForce === "number" ? window.simulatedForce : this.#force;
    return true;
  }

  isConnected() {
    return this.#connected;
  }

  disconnect() {
    clearInterval(this.#timer);
    this.#connected = false;
    document.removeEventListener("keydown", this.#onKey);
    document.removeEventListener("keyup", this.#onKey);
  }
}
