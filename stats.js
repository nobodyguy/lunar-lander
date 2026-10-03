import {
  onActivate,
  formatSpeed,
  formatHeight,
  UNIT_SYSTEMS,
} from "./helpers/helpers.js";

export const showStatsAndResetControl = (
  state,
  animationObject,
  data,
  hasKeyboard,
  onReset
) => {
  const buttonDelayTime = 1500;
  const canShowShareSheet = navigator.canShare;
  const showStats = () => {
    document.querySelector("#endGameStats").classList.add("show");
    document.querySelector("#tryAgain").classList.add("loading");
  };
  const settings = state.get("settings");
  let hasReset = false;

  // Built on demand so it follows a units change made on this screen
  const getShareText = () => {
    const units = settings.get("units");
    const speedLabel = UNIT_SYSTEMS[units].speedLabel.toLowerCase();
    const fuel =
      data.fuelPercent === null ? "" : ` | ${data.fuelPercent}% fuel left`;

    return `Challenge #${state.get("challengeManager").getChallengeNumber()}
${data.scoreForDisplay} point ${data.landed ? "landing" : "crash"}

${data.scoreDescription}
https://nobodyguy.github.io/lunar-lander/

${formatSpeed(data.speedMph, units)}${speedLabel} | ${data.angle}° | ${
      data.rotationsFormatted
    } flip${data.rotationsInt === 1 ? "" : "s"} | ${data.duration} | ${
      data.engineActivations
    } burn${data.engineActivations === 1 ? "" : "s"}${fuel}`;
  };

  const hideStats = () => {
    document.querySelector("#endGameStats").classList.remove("show");
  };

  const populateMeter = (name, percentPosition, textValue) => {
    const meter = document.querySelector(`[data-stat-name="${name}"]`);
    meter.querySelector("[data-value]").textContent = textValue;

    // This timeout enables a CSS transition to play from left: 0 to the
    // override we're applying
    setTimeout(() => {
      meter
        .querySelector("[data-percent-position]")
        .style.setProperty("--meter-progress", percentPosition);
    }, 0);
  };

  const resetMeter = (name) => {
    const meter = document.querySelector(`[data-stat-name="${name}"]`);
    meter.querySelector("[data-value]").textContent = "";

    meter
      .querySelector("[data-percent-position]")
      .style.setProperty("--meter-progress", 0);
  };

  const populateStats = (data) => {
    document.querySelector("#description").textContent = data.scoreDescription;
    document.querySelector("#score").textContent = data.scoreForDisplay;
    document.querySelector("#type").textContent = data.landed
      ? "landing"
      : "crash";
    populateMeter("speed", data.speedPercent, "");
    populateMeter("angle", data.anglePercent, data.angle);
    populateUnitValues();

    document.querySelector("#duration").textContent = data.duration;
    document.querySelector("#rotations").textContent = data.rotationsFormatted;
    document.querySelector("#engineActivations").textContent =
      data.engineActivationsFormatted;

    const fuelRow = document.querySelector("#fuelLeftRow");
    fuelRow.hidden = data.fuelPercent === null;
    document.querySelector("#fuelLeft").textContent = `${data.fuelPercent}%`;

    if (settings.get("controls") === "force") {
      document.querySelector("#tryAgainText").textContent =
        "Play Again (Pull)";
    } else if (hasKeyboard) {
      document.querySelector("#tryAgainText").textContent =
        "Play Again (Space)";
    } else {
      document.querySelector("#tryAgainText").textContent = "Play Again";
    }

    if (!canShowShareSheet && document.querySelector("#share")) {
      document.querySelector("#share").remove();
    }
  };

  // Separate from populateStats so a units change can redraw just these
  // without replaying the meter animation
  function populateUnitValues() {
    const units = settings.get("units");
    document.querySelector('[data-stat-name="speed"] [data-value]').textContent =
      formatSpeed(data.speedMph, units);
    document.querySelector("#maxSpeed").textContent = formatSpeed(
      data.maxSpeedMph,
      units
    );
    document.querySelector("#maxHeight").textContent = formatHeight(
      data.maxHeightFt,
      units
    );
  }

  function showShareSheet() {
    Promise.resolve()
      .then(() => navigator.share({ text: getShareText() }))
      .catch(() => {});
  }

  // Space inside the settings dialog belongs to its controls
  function tryAgainOnSpace({ code, target }) {
    if (code === "Space" && !target.closest("dialog")) tryAgain();
  }

  // Collected so that every listener attached for this game-over screen is
  // guaranteed to come back off again, including the share button's, which
  // used to be left behind and stack up a duplicate every round.
  let detachers = [];

  const attachEventListeners = () => {
    detachers.push(
      settings.subscribe((key) => {
        if (key === "units") populateUnitValues();
      })
    );

    // Delay showing the reset button in case the user is actively tapping
    // in that area for thrust
    setTimeout(() => {
      if (hasReset) return;
      document.querySelector("#tryAgain").classList.remove("loading");
      detachers.push(
        onActivate(document.querySelector("#tryAgain"), tryAgain)
      );
      // A fresh pull past the lower threshold on the force sensor. Only a
      // new pull counts, so a player still pulling as the round ended has to
      // let go first. Ignored while the settings sheet is open, where pulls
      // are for trying out the mapping.
      detachers.push(
        state.get("forceInput").onPress(() => {
          if (!document.querySelector("#settings").open) tryAgain();
        })
      );
    }, buttonDelayTime);

    if (canShowShareSheet) {
      detachers.push(
        onActivate(document.querySelector("#share"), showShareSheet)
      );
    }

    if (hasKeyboard) {
      // Delay showing the reset button in case the user is actively tapping
      // in that area for thrust
      setTimeout(() => {
        if (hasReset) return;
        document.addEventListener("keydown", tryAgainOnSpace);
        detachers.push(() =>
          document.removeEventListener("keydown", tryAgainOnSpace)
        );
      }, buttonDelayTime);
    }
  };

  const detachEventListeners = () => {
    detachers.forEach((detach) => detach());
    detachers = [];
  };

  function tryAgain() {
    // The global Space shortcut and the focused button can both fire for one
    // keypress, and resetting the round twice would advance past the daily
    // challenge state.
    if (hasReset) return;
    hasReset = true;

    animationObject.resetStartTime();
    resetMeter("speed");
    resetMeter("angle");
    hideStats();
    detachEventListeners();
    onReset();
  }

  populateStats(data);
  showStats();
  attachEventListeners();
};
