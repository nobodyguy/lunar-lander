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
  progressor: {
    label: "Tindeq Progressor",
    make: () => new Progressor(),
    // Any command (tare, battery) ends its weight stream until it's restarted
    commandsStopStream: true,
  },
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
// Devices without hardware tare average the stream for this long instead
const SOFTWARE_TARE_MS = 2000;
const HARDWARE_TARE_MS = 600;
// Battery drains slowly, so a reading this fresh is left alone. Reads only
// happen between rounds or in settings, never mid-flight.
const BATTERY_MAX_AGE_MS = 5 * 60 * 1000;
// Above this the player is pulling, and a battery read could cut the engine
const PULLING_KG = 0.3;

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
  let batteryReadAt = 0;
  let readingBattery = false;
  let taringUntil = 0;
  let watchdogTimer = null;
  let restarting = false;

  const statusListeners = new Set();
  const sampleListeners = new Set();

  const emit = () => statusListeners.forEach((listener) => listener());

  const setStatus = (nextStatus, nextError = null) => {
    status = nextStatus;
    error = nextError;
    emit();
  };

  const isStreaming = () =>
    status === "connected" && performance.now() - lastSampleAt < STALE_AFTER_MS;
  const isTaring = () => performance.now() < taringUntil;
  const commandsStopStream = () => !!DEVICES[deviceKey]?.commandsStopStream;

  const readBattery = async () => {
    if (!device?.battery) return;
    batteryReadAt = performance.now();
    try {
      const percent = batteryPercent(await withTimeout(device.battery(), 1500));
      if (percent !== null) {
        battery = percent;
        emit();
      }
    } catch {}
  };

  // Skipped if the device was swapped or dropped since the caller began
  const restartStream = async (current) => {
    if (restarting || current !== device || status !== "connected") return;
    if (!current.stream) return;
    restarting = true;
    try {
      await withTimeout(current.stream(), 1000);
    } catch {}
    restarting = false;
  };

  // Called at moments a brief dropout can't cost anything: between rounds and
  // while settings are open. A read never happens mid-pull, and on a sensor
  // whose stream it stops, the stream is started again straight after.
  const refreshBattery = async (maxAgeMs = BATTERY_MAX_AGE_MS) => {
    if (status !== "connected" || readingBattery || isTaring()) return;
    if (performance.now() - batteryReadAt < maxAgeMs) return;
    if (isStreaming() && force > PULLING_KG) return;
    const current = device;
    readingBattery = true;
    await readBattery();
    readingBattery = false;
    if (commandsStopStream()) await restartStream(current);
  };

  const stopTimers = () => {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
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
    // The library logs every pull start and stop to the console by default
    current.active?.(() => {});

    setStatus("connecting");

    await current.connect(
      async () => {
        current.bluetooth?.removeEventListener("gattserverdisconnected", onLost);
        current.bluetooth?.addEventListener("gattserverdisconnected", onLost);
        await readBattery();
        // Some scales stream as soon as they connect and have no stream()
        await current.stream?.();
        lastSampleAt = performance.now();
        // Last resort for a stream that stops for any other reason
        watchdogTimer = setInterval(() => {
          if (!isStreaming()) restartStream(current);
        }, STALE_AFTER_MS);
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
    batteryReadAt = 0;
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
    const current = device;
    current.tare(SOFTWARE_TARE_MS);
    taringUntil =
      performance.now() +
      (current.usesHardwareTare ? HARDWARE_TARE_MS : SOFTWARE_TARE_MS);
    emit();
    setTimeout(async () => {
      if (commandsStopStream()) await restartStream(current);
      emit();
    }, taringUntil - performance.now() + 50);
  };

  return {
    connect,
    disconnect,
    tare,
    refreshBattery,
    isStreaming,
    // Zero whenever the stream isn't live, so nothing downstream has to ask
    getForce: () => (isStreaming() ? force : 0),
    getStatus: () => status,
    getError: () => error,
    getBattery: () => battery,
    getDeviceKey: () => deviceKey,
    isTaring,
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
