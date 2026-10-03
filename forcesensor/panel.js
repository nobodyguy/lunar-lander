import { DEVICES } from "./device.js";
import {
  getMapping,
  forceToThrottle,
  hoverForce,
  isHoverBelowThreshold,
  releaseForce,
} from "./mapping.js";
import { DIFFICULTY_DESCRIPTIONS } from "../helpers/rules.js";

const MEASURE_MS = 3000;

const STATUS_TEXT = {
  unsupported: "Bluetooth unavailable",
  disconnected: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  lost: "Connection lost",
  error: "Couldn't connect",
};

const CONNECT_LABEL = {
  unsupported: "Connect",
  disconnected: "Connect",
  connecting: "Connecting…",
  connected: "Disconnect",
  lost: "Reconnect",
  error: "Try again",
};

const formatKg = (kg) => `${kg.toFixed(1)} kg`;

// Wires the force sensor parts of the settings sheet, and the status pill
// shown over the game while force controls are selected
export const manageForceSettings = (
  settings,
  sensor,
  forceInput,
  { openSettings }
) => {
  const $ = (selector) => document.querySelector(selector);
  const dialog = $("#settings");
  const forceSection = $("#forceSettings");
  const fuelGroup = $("#fuelGroup");
  const deviceSelect = $("#sensorDevice");
  const statusElement = $("#sensorStatus");
  const statusText = $("#sensorStatusText");
  const batteryElement = $("#sensorBattery");
  const connectButton = $("#sensorConnect");
  const tareButton = $("#sensorTare");
  const sensorHint = $("#sensorHint");
  const meter = $("#forceMeter");
  const forceValue = $("#forceValue");
  const throttleValue = $("#throttleValue");
  const measureButton = $("#measureFmax");
  const hoverOutput = $("#hoverOutput");
  const thresholdHint = $("#thresholdHint");
  const hoverWarning = $("#hoverWarning");
  const difficultyHint = $("#difficultyHint");
  const pill = $("#sensorPill");
  const pillText = $("#sensorPillText");

  let measuring = null;

  Object.entries(DEVICES).forEach(([key, { label }]) => {
    deviceSelect.append(new Option(label, key));
  });
  deviceSelect.value = settings.get("device");

  // "connected" with no samples arriving reads as its own state, since it
  // means the stream stalled even though the link is up
  const effectiveStatus = () => {
    const status = sensor.getStatus();
    return status === "connected" && !sensor.isStreaming() ? "stalled" : status;
  };

  const renderStatus = () => {
    const status = sensor.getStatus();
    const effective = effectiveStatus();
    const battery = sensor.getBattery();
    const isForce = settings.get("controls") === "force";

    statusElement.dataset.status = effective;
    statusText.textContent =
      effective === "stalled"
        ? "Connected, waiting for data…"
        : sensor.isTaring()
        ? "Taring, keep the sensor still…"
        : STATUS_TEXT[status];
    batteryElement.hidden = battery === null;
    batteryElement.textContent = battery === null ? "" : `Battery ${battery}%`;
    batteryElement.classList.toggle("low", battery !== null && battery <= 15);

    connectButton.textContent = CONNECT_LABEL[status];
    connectButton.disabled = status === "unsupported" || status === "connecting";
    tareButton.disabled = status !== "connected" || sensor.isTaring();
    measureButton.disabled = status !== "connected" || measuring !== null;
    deviceSelect.disabled = status === "connecting" || status === "connected";

    const deviceNote = DEVICES[deviceSelect.value].note;
    sensorHint.textContent =
      status === "unsupported"
        ? "This browser can't use Bluetooth. Try Chrome or Edge on a computer or Android phone."
        : status === "error" || status === "lost"
        ? sensor.getError()
        : status === "connected"
        ? "Tare with nothing pulling on the sensor. Settings stay open while you test your pull below."
        : deviceNote ||
          "Switch the sensor on, then connect and pick it from the list.";

    pill.hidden = !isForce;
    pill.dataset.status = effective;
    const name = DEVICES[sensor.getDeviceKey() ?? settings.get("device")].label;
    pillText.textContent =
      effective === "connected"
        ? `${name}${battery === null ? "" : ` · ${battery}%`}`
        : effective === "stalled"
        ? `${name} · no data`
        : status === "connecting"
        ? "Connecting…"
        : "Connect force sensor";
  };

  const renderMapping = () => {
    const mapping = getMapping(settings);
    hoverOutput.textContent = `${mapping.hover}% · ${formatKg(hoverForce(mapping))}`;
    thresholdHint.textContent = `Pulls under this are ignored. Once the engine is on it stays on until you drop below ${formatKg(
      releaseForce(mapping.threshold)
    )}.`;
    hoverWarning.hidden = !isHoverBelowThreshold(mapping);

    const toPercent = (kg) => `${Math.min(100, (kg / mapping.fmax) * 100)}%`;
    meter.style.setProperty("--threshold", toPercent(mapping.threshold));
    meter.style.setProperty("--hover", toPercent(hoverForce(mapping)));
  };

  const renderControls = () => {
    const isForce = settings.get("controls") === "force";
    forceSection.hidden = !isForce;
    fuelGroup.hidden = isForce;
    document
      .querySelectorAll("[data-for-controls]")
      .forEach((element) => {
        element.hidden = element.dataset.forControls !== settings.get("controls");
      });
    difficultyHint.textContent = DIFFICULTY_DESCRIPTIONS[settings.get("difficulty")];
    renderStatus();
  };

  // Live readout while the sheet is open, so the mapping can be tried out
  // with real pulls before closing it
  const renderLive = () => {
    if (!dialog.open) return;
    const force = sensor.getForce();
    const mapping = getMapping(settings);
    meter.style.setProperty("--force", `${Math.min(100, Math.max(0, (force / mapping.fmax) * 100))}%`);
    meter.classList.toggle("active", forceInput.isActive());
    forceValue.textContent = force.toFixed(1);
    throttleValue.textContent = forceInput.isActive()
      ? `${Math.round(forceToThrottle(force, mapping) * 100)}% thrust`
      : "engine off";

    if (measuring) {
      measuring.peak = Math.max(measuring.peak, force);
      const left = Math.ceil((measuring.endsAt - performance.now()) / 1000);
      measureButton.textContent = left > 0 ? `Pull hard… ${left}` : "Measure";
      if (left <= 0) finishMeasuring();
    }

    requestAnimationFrame(renderLive);
  };

  // Max force is set from the hardest pull over a few seconds, so full
  // thrust sits at a force the player can actually reach
  const finishMeasuring = () => {
    const { peak } = measuring;
    measuring = null;
    measureButton.textContent = "Measure";
    if (peak > settings.get("threshold") + 1) settings.set("fmax", peak);
    renderStatus();
  };

  measureButton.addEventListener("click", () => {
    if (measuring || sensor.getStatus() !== "connected") return;
    measuring = { peak: 0, endsAt: performance.now() + MEASURE_MS };
    renderStatus();
  });

  connectButton.addEventListener("click", () => {
    const status = sensor.getStatus();
    if (status === "connected") sensor.disconnect();
    else sensor.connect(deviceSelect.value);
  });

  tareButton.addEventListener("click", () => sensor.tare());

  deviceSelect.addEventListener("change", renderStatus);

  // Enter in a number field would otherwise submit the dialog's form and
  // close the sheet; commit the value instead
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.type === "number") {
      event.preventDefault();
      event.target.blur();
    }
  });

  pill.addEventListener("click", openSettings);


  sensor.subscribe(renderStatus);
  settings.subscribe((key) => {
    if (key === "controls" || key === "difficulty") renderControls();
    if (["fmax", "hover", "threshold", "curve"].includes(key)) renderMapping();
    if (key === "device") renderStatus();
  });

  // Catches a stream that stalls, which doesn't announce itself
  setInterval(renderStatus, 1000);

  renderControls();
  renderMapping();

  // Called by the settings dialog as it opens
  const onOpen = () => {
    renderControls();
    renderMapping();
    requestAnimationFrame(renderLive);
  };

  return { onOpen };
};
