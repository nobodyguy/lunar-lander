import { DEVICES } from "./forcesensor/device.js";

// Each setting is either a list of allowed values or a numeric range
const OPTIONS = {
  units: ["metric", "imperial"],
  fuel: ["unlimited", "limited"],
  controls: ["standard", "force"],
  device: Object.keys(DEVICES),
  difficulty: ["easy", "medium", "hard"],
  curve: ["linear", "exponential"],
  sound: ["on", "off"],
  // kg that maps to full throttle
  fmax: { min: 2, max: 200, step: 0.5 },
  // % of fmax at which the lander hovers
  hover: { min: 5, max: 90, step: 1 },
  // kg below which input is ignored
  threshold: { min: 0.2, max: 20, step: 0.1 },
};

const DEFAULTS = {
  units: "metric",
  fuel: "limited",
  controls: "standard",
  device: "progressor",
  difficulty: "medium",
  curve: "linear",
  sound: "on",
  fmax: 20,
  hover: 30,
  threshold: 1,
};

const STORAGE_KEY = "settings";

// Returns the value as stored, or undefined if it isn't allowed
const validate = (key, value) => {
  const option = OPTIONS[key];
  if (Array.isArray(option)) return option.includes(value) ? value : undefined;

  const number = typeof value === "string" ? parseFloat(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return undefined;
  const stepped = Math.round(number / option.step) * option.step;
  // Rounded again so 0.1 steps don't store as 1.2000000000000002
  return +Math.min(option.max, Math.max(option.min, stepped)).toFixed(3);
};

export const makeSettingsManager = () => {
  // Anything stored that is no longer a valid option falls back to the default
  const stored = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  })();

  const values = Object.fromEntries(
    Object.entries(DEFAULTS).map(([key, fallback]) => [
      key,
      validate(key, stored[key]) ?? fallback,
    ])
  );

  const listeners = new Set();

  const get = (key) => values[key];

  const set = (key, rawValue) => {
    const value = validate(key, rawValue);
    if (value === undefined || values[key] === value) return;
    values[key] = value;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    } catch {}
    listeners.forEach((listener) => listener(key, value));
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { get, set, subscribe, getRange: (key) => OPTIONS[key] };
};

export const manageSettingsDialog = (settings, { onOpen, onClose }) => {
  const dialog = document.querySelector("#settings");
  const openButton = document.querySelector("#openSettings");

  // Every named input and select in the dialog is bound to the setting of the
  // same name
  const syncInputs = () => {
    dialog.querySelectorAll("input[name], select[name]").forEach((input) => {
      if (!(input.name in DEFAULTS)) return;
      if (input.type === "radio") {
        input.checked = settings.get(input.name) === input.value;
      } else if (document.activeElement !== input) {
        input.value = settings.get(input.name);
      }
    });
  };

  const apply = ({ target }) => {
    if (!(target.name in DEFAULTS)) return;
    if (target.type === "radio" && !target.checked) return;
    settings.set(target.name, target.value);
  };

  // Sliders apply as they move. Typed numbers apply when committed, and are
  // then rewritten to the value actually kept, which may have been clamped.
  dialog.addEventListener("input", (event) => {
    if (event.target.type === "range") apply(event);
  });
  dialog.addEventListener("change", (event) => {
    apply(event);
    if (event.target.type === "number") {
      event.target.value = settings.get(event.target.name);
    }
  });

  settings.subscribe(syncInputs);

  // Fires for Esc and the Done button alike. The dialog hands focus back to
  // the gear button, where Space — the Play Again shortcut — would also
  // click it and reopen the dialog.
  dialog.addEventListener("close", () => {
    openButton.blur();
    onClose();
  });

  // A click whose target is the dialog itself landed on the backdrop, since
  // the visible panel is filled edge to edge by its inner wrapper
  dialog.addEventListener("click", ({ target }) => {
    if (target === dialog) dialog.close();
  });

  const open = () => {
    if (dialog.open) return;
    syncInputs();
    dialog.showModal();
    onOpen();
  };

  openButton.addEventListener("click", open);

  return { open };
};

// A quick toggle beside the gear, kept in step with the Sound setting
export const manageSoundButton = (settings) => {
  const button = document.querySelector("#toggleSound");

  const render = () => {
    const muted = settings.get("sound") === "off";
    button.setAttribute("aria-pressed", muted);
    button.title = muted ? "Unmute sound" : "Mute sound";
  };

  button.addEventListener("click", () => {
    settings.set("sound", settings.get("sound") === "off" ? "on" : "off");
    // Otherwise it keeps focus, and Space, the Play Again shortcut, would
    // also toggle it
    button.blur();
  });

  settings.subscribe((key) => {
    if (key === "sound") render();
  });
  render();
};
