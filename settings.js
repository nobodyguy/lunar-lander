const OPTIONS = {
  units: ["metric", "imperial"],
  fuel: ["unlimited", "limited"],
};

const DEFAULTS = { units: "metric", fuel: "unlimited" };

const STORAGE_KEY = "settings";

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
      OPTIONS[key].includes(stored[key]) ? stored[key] : fallback,
    ])
  );

  const listeners = new Set();

  const get = (key) => values[key];

  const set = (key, value) => {
    if (!OPTIONS[key].includes(value) || values[key] === value) return;
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

  return { get, set, subscribe };
};

export const manageSettingsDialog = (settings, { onOpen, onClose }) => {
  const dialog = document.querySelector("#settings");
  const openButton = document.querySelector("#openSettings");

  const syncInputs = () => {
    dialog.querySelectorAll("input[type=radio]").forEach((input) => {
      input.checked = settings.get(input.name) === input.value;
    });
  };

  dialog.addEventListener("change", ({ target }) => {
    if (target.type === "radio") settings.set(target.name, target.value);
  });

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

  openButton.addEventListener("click", () => {
    if (dialog.open) return;
    syncInputs();
    dialog.showModal();
    onOpen();
  });
};
