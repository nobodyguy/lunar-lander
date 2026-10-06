import {
  Progressor,
  ForceBoard,
  WHC06,
  CTS500,
  Entralpi,
  Motherboard,
  Climbro,
} from "@hangtime/grip-connect";
import { SimulatedSensor, isSimulatorEnabled } from "./simulator.js";

// The force-measuring devices grip-connect supports. The first is the default.
export const DEVICES = {
  progressor: { label: "Tindeq Progressor", make: () => new Progressor() },
  forceboard: { label: "PitchSix Force Board", make: () => new ForceBoard() },
  whc06: {
    label: "Weiheng WH-C06",
    make: () => new WHC06(),
    note: "Chrome needs chrome://flags/#enable-experimental-web-platform-features turned on for this scale.",
  },
  cts500: { label: "CTS500", make: () => new CTS500() },
  entralpi: { label: "Entralpi", make: () => new Entralpi() },
  motherboard: { label: "Griptonite Motherboard", make: () => new Motherboard() },
  climbro: { label: "Climbro", make: () => new Climbro() },
  ...(isSimulatorEnabled() && {
    simulator: {
      label: "Simulator (hold ↑)",
      make: () => new SimulatedSensor(),
    },
  }),
};

// A stream that has gone quiet for this long is treated as zero force, so a
// sensor that drops out mid-flight cuts the engine rather than holding it on
const STALE_AFTER_MS = 1500;
const BATTERY_POLL_MS = 60000;
// Devices without hardware tare average the stream for this long instead
const SOFTWARE_TARE_MS = 2000;

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);

// Devices report battery as a percentage, in volts or in millivolts. Voltages
// are mapped onto a single-cell lithium battery's usable range.
export const batteryPercent = (raw) => {
  const value = parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return null;

  const volts = value > 1000 ? value / 1000 : value <= 10 ? value : null;
  const percent = volts === null ? value : ((volts - 3.3) / (4.2 - 3.3)) * 100;
  return Math.round(Math.min(100, Math.max(0, percent)));
};

// Every iOS browser runs on Safari's engine, which has no Web Bluetooth, so
// iOS players are pointed to Bluefy, a browser that adds it. iPads ask for
// the desktop site, so they read as a Mac with a touchscreen.
const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

// status: "unsupported" | "disconnected" | "connecting" | "connected" | "lost" | "error"
export const makeForceSensor = () => {
  const supported =
    (typeof navigator !== "undefined" && !!navigator.bluetooth) ||
    isSimulatorEnabled();

  let status = supported ? "disconnected" : "unsupported";
  let error = null;
  let device = null;
  let deviceKey = null;
  let force = 0;
  let lastSampleAt = 0;
  let battery = null;
  let taringUntil = 0;
  let batteryTimer = null;

  const statusListeners = new Set();
  const sampleListeners = new Set();

  const emit = () => statusListeners.forEach((listener) => listener());

  const setStatus = (nextStatus, nextError = null) => {
    status = nextStatus;
    error = nextError;
    emit();
  };

  const readBattery = async () => {
    if (!device?.battery) return;
    try {
      const percent = batteryPercent(await withTimeout(device.battery(), 1500));
      if (percent !== null) {
        battery = percent;
        emit();
      }
    } catch {}
  };

  const stopTimers = () => {
    clearInterval(batteryTimer);
    batteryTimer = null;
  };

  // Fired by the browser when the link drops on its own. The library already
  // cleans itself up; the device object is kept so Reconnect can skip the
  // chooser and go straight back to the same sensor.
  const onLost = () => {
    if (status !== "connected") return;
    stopTimers();
    force = 0;
    setStatus("lost", "The sensor disconnected.");
  };

  const connect = async (key) => {
    if (!supported || status === "connecting" || status === "connected") return;

    // Reuse the device object only to reconnect to the same sensor
    if (!device || deviceKey !== key) {
      device = DEVICES[key].make();
      deviceKey = key;
      battery = null;
    }

    const current = device;
    current.notify((data) => {
      if (current !== device) return;
      force = data.current;
      lastSampleAt = performance.now();
      sampleListeners.forEach((listener) => listener(force));
    }, "kg");

    setStatus("connecting");

    await current.connect(
      async () => {
        current.bluetooth?.removeEventListener("gattserverdisconnected", onLost);
        current.bluetooth?.addEventListener("gattserverdisconnected", onLost);
        await readBattery();
        // Some scales stream as soon as they connect and have no stream()
        await current.stream?.();
        lastSampleAt = performance.now();
        batteryTimer = setInterval(readBattery, BATTERY_POLL_MS);
        setStatus("connected");
      },
      (connectError) => {
        if (current !== device) return;
        // Closing the browser's device chooser isn't a failure worth showing
        if (connectError?.name === "NotFoundError") {
          device = null;
          setStatus("disconnected");
        } else {
          setStatus("error", connectError?.message || "Couldn't connect.");
        }
      }
    );
  };

  const disconnect = async () => {
    const current = device;
    device = null;
    deviceKey = null;
    stopTimers();
    force = 0;
    battery = null;
    if (current) {
      current.bluetooth?.removeEventListener("gattserverdisconnected", onLost);
      if (current.isConnected()) {
        try {
          await withTimeout(current.stop?.(), 500);
        } catch {}
      }
      current.disconnect();
    }
    if (supported) setStatus("disconnected");
  };

  const tare = () => {
    if (status !== "connected") return;
    device.tare(SOFTWARE_TARE_MS);
    taringUntil =
      performance.now() + (device.usesHardwareTare ? 600 : SOFTWARE_TARE_MS);
    emit();
    setTimeout(emit, taringUntil - performance.now() + 50);
  };

  const isStreaming = () =>
    status === "connected" && performance.now() - lastSampleAt < STALE_AFTER_MS;

  return {
    connect,
    disconnect,
    tare,
    isStreaming,
    // Zero whenever the stream isn't live, so nothing downstream has to ask
    getForce: () => (isStreaming() ? force : 0),
    getStatus: () => status,
    getError: () => error,
    getBattery: () => battery,
    getDeviceKey: () => deviceKey,
    isTaring: () => performance.now() < taringUntil,
    isSupported: () => supported,
    // True on iOS outside Bluefy, where the way to fly is to switch browsers
    needsBluefy: () => !supported && isIOS(),
    subscribe: (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    onSample: (listener) => {
      sampleListeners.add(listener);
      return () => sampleListeners.delete(listener);
    },
  };
};
