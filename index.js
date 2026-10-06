import {
  animate,
  clampedProgress,
  formatNumber,
  generateCanvas,
  randomBetween,
  seededRandomBetween,
  seededRandomBool,
  transition,
  UNIT_SYSTEMS,
} from "./helpers/helpers.js";
import { makeLander } from "./lander/lander.js";
import { makeToyLander } from "./lander/toylander.js";
import { makeStarfield } from "./starfield.js";
import { makeControls } from "./lander/controls.js";
import { makeTerrain } from "./terrain.js";
import { showStatsAndResetControl } from "./stats.js";
import { manageInstructions } from "./instructions.js";
import { makeAudioManager } from "./helpers/audio.js";
import { makeStateManager } from "./helpers/state.js";
import { makeConfetti } from "./lander/confetti.js";
import { makeTallyManger } from "./tally.js";
import { makeAsteroid } from "./asteroids.js";
import { makeSpaceAsteroid } from "./spaceAsteroids.js";
import { makeChallengeManager } from "./challenge.js";
import { makeSeededRandom } from "./helpers/seededrandom.js";
import { makeBonusPointsManager } from "./bonuspoints.js";
import { makeTheme } from "./theme.js";
import {
  makeSettingsManager,
  manageSettingsDialog,
  manageSoundButton,
} from "./settings.js";
import { TRANSITION_TO_SPACE } from "./helpers/constants.js";
import { makeRules } from "./helpers/rules.js";
import { makeForceSensor } from "./forcesensor/device.js";
import { makeForceInput } from "./forcesensor/input.js";
import { manageForceSettings } from "./forcesensor/panel.js";
import { makeForceControls } from "./lander/forcecontrols.js";
import { keepScreenOn } from "./helpers/wakelock.js";
import {
  landingScoreDescription,
  crashScoreDescription,
  destroyedDescription,
  hoverslamDescription,
} from "./helpers/scoring.js";

// SETUP

keepScreenOn();
const settings = makeSettingsManager();
const audioManager = makeAudioManager(settings);
const [CTX, canvasWidth, canvasHeight, canvasElement, scaleFactor] =
  generateCanvas({
    width: window.innerWidth,
    height: window.innerHeight,
    attachNode: ".game",
  });
const challengeManager = makeChallengeManager();
const seededRandom = makeSeededRandom();
const forceSensor = makeForceSensor();
const forceInput = makeForceInput(forceSensor, settings);

const appState = makeStateManager()
  .set("CTX", CTX)
  .set("canvasWidth", canvasWidth)
  .set("canvasHeight", canvasHeight)
  .set("canvasElement", canvasElement)
  .set("scaleFactor", scaleFactor)
  .set("audioManager", audioManager)
  .set("challengeManager", challengeManager)
  .set("seededRandom", seededRandom)
  .set("settings", settings)
  .set("rules", makeRules(settings))
  .set("forceInput", forceInput);

appState.set("theme", makeTheme(appState));

const terrain = makeTerrain(appState);
appState.set("terrain", terrain);

const bonusPointsManager = makeBonusPointsManager(appState);
appState.set("bonusPointsManager", bonusPointsManager);

const stars = makeStarfield(appState);
const instructions = manageInstructions(onCloseInstructions);
const toyLander = makeToyLander(
  appState,
  () => instructions.setEngineDone(),
  () => instructions.setLeftRotationDone(),
  () => instructions.setRightRotationDone(),
  () => instructions.setEngineAndRotationDone()
);
const toyLanderControls = makeControls(appState, toyLander, audioManager);
const lander = makeLander(appState, onGameEnd);
const landerControls = makeControls(appState, lander, audioManager);
const forceControls = makeForceControls(
  appState,
  lander,
  audioManager,
  forceInput
);
// The tutorial always uses the keys and touch; the real game uses whichever
// the settings pick
const gameControls = () =>
  settings.get("controls") === "force" ? forceControls : landerControls;
const tally = makeTallyManger();

const asteroidRandom = seededRandom.getStream("asteroids");
let sendAsteroid = seededRandomBool(asteroidRandom);
let asteroidCountdown = seededRandomBetween(2000, 15000, asteroidRandom);
let asteroids = [
  makeAsteroid(appState, lander.getDisplayPosition, onAsteroidImpact),
];
let spaceAsteroids = [];
let randomConfetti = [];

let gameEnded = false;

// INSTRUCTIONS SHOW/HIDE

if (!instructions.hasClosedInstructions()) {
  instructions.show();
  toyLanderControls.attachEventListeners();
} else {
  gameControls().attachEventListeners();
  challengeManager.populateCornerInfo();
  terrain.setShowLandingSurfaces();
}

// SETTINGS

const updateUnitLabels = () => {
  const { speedLabel, heightLabel } = UNIT_SYSTEMS[settings.get("units")];
  document
    .querySelectorAll('[data-unit="speed"]')
    .forEach((element) => (element.textContent = speedLabel));
  document
    .querySelectorAll('[data-unit="height"]')
    .forEach((element) => (element.textContent = heightLabel));
};
updateUnitLabels();
settings.subscribe((key) => {
  if (key === "units") updateUnitLabels();
});

// Whichever controls are live are taken away while the dialog is open, so
// the arrow keys move between options instead of firing the thrusters. The
// game is paused rather than left to fall into the terrain behind the dialog.
// The tutorial can finish while the dialog is open, so the controls to restore
// are looked up again on close rather than remembered from open.
// The controls setting can also change while it's open, which is why the
// lookup happens again on close.
const activeControls = () =>
  instructions.hasClosedInstructions() ? gameControls() : toyLanderControls;
let detachedForSettings = false;

// Gravity, pad size and the rest can't sensibly change mid-flight, so a
// round in progress starts over when the sheet closes after such a change
let rulesChangedInSettings = false;
settings.subscribe((key) => {
  if (key === "controls" || key === "difficulty") rulesChangedInSettings = true;
});

// Force controls can't fly without a live sensor, so a round holds still,
// clock included, until one is streaming. That covers starting up as well
// as a sensor that drops out mid-flight, which resumes where it left off.
let settingsOpen = false;
const sensorWait = document.querySelector("#sensorWait");
const SENSOR_WAIT_TEXT = {
  connecting: "Connecting to your force sensor…",
  lost: "The force sensor disconnected. Reconnect to carry on.",
  connected: "Waiting for data from the force sensor…",
  unsupported: forceSensor.needsBluefy()
    ? "Flying with a force sensor on iPhone or iPad needs the Bluefy browser."
    : "This browser can't use Bluetooth, which the force sensor needs.",
};

const updatePause = () => {
  const waiting =
    settings.get("controls") === "force" &&
    instructions.hasClosedInstructions() &&
    !gameEnded &&
    !forceSensor.isStreaming();

  sensorWait.hidden = !waiting || settingsOpen;
  document.querySelector("#sensorWaitText").textContent =
    SENSOR_WAIT_TEXT[forceSensor.getStatus()] ??
    "Connect your force sensor to fly";
  animationObject.setPaused(settingsOpen || waiting);
};
// Polled as well, since a stalled stream doesn't announce itself. The first
// check runs after the first frame has been drawn, so a paused start still
// shows the scene.
setInterval(updatePause, 250);
forceSensor.subscribe(updatePause);
document
  .querySelector("#sensorWaitButton")
  .addEventListener("click", () => settingsDialog.open());

const settingsDialog = manageSettingsDialog(settings, {
  onOpen: () => {
    settingsOpen = true;
    animationObject.setPaused(true);
    rulesChangedInSettings = false;
    detachedForSettings = !gameEnded;
    if (detachedForSettings) activeControls().detachEventListeners();
    forceSettings.onOpen();
  },
  onClose: () => {
    settingsOpen = false;
    if (
      rulesChangedInSettings &&
      detachedForSettings &&
      instructions.hasClosedInstructions()
    ) {
      animationObject.resetStartTime();
      resetRoundState();
    } else if (detachedForSettings) {
      activeControls().attachEventListeners();
    }
    detachedForSettings = false;
    rulesChangedInSettings = false;
    updatePause();
  },
});

manageSoundButton(settings);

const forceSettings = manageForceSettings(settings, forceSensor, forceInput, {
  openSettings: settingsDialog.open,
});

// MAIN ANIMATION LOOP

const animationObject = animate((timeSinceStart, deltaTime) => {
  CTX.fillStyle = appState.get("theme").backgroundGradient;
  CTX.fillRect(0, 0, canvasWidth, canvasHeight);

  // Move stars in parallax as lander flies high
  stars.draw(lander.getVelocity(), deltaTime);

  // How far the terrain and everything anchored to it is pushed down the
  // screen as the lander climbs. Asteroids need the same value to hit-test
  // against where they are actually drawn.
  const terrainOffset = transition(
    0,
    terrain.getLandingData().terrainHeight,
    clampedProgress(TRANSITION_TO_SPACE, 0, lander.getPosition().y)
  );

  // Move terrain as lander flies high
  CTX.save();
  CTX.translate(0, terrainOffset);
  terrain.draw();
  if (instructions.hasClosedInstructions() && !gameEnded) {
    forceControls.drawTargetMarker(timeSinceStart);
  }
  CTX.restore();

  if (instructions.hasClosedInstructions()) {
    landerControls.drawTouchOverlay();
    forceControls.drawThrottleGauge();

    bonusPointsManager.draw(lander.getPosition().y < TRANSITION_TO_SPACE);

    // Generate and draw space asteroids
    if (lander.getPosition().y < -canvasHeight * 2) {
      // The chance that an asteroid will be sent is determined by the screen
      // width. This means that the density of asteroids will be similar across
      // phones and wider desktop screens. On a 14" MacBook the chance of an
      // asteroid being sent in any given frame is ~1 in 50; on an iPhone 14
      // it's ~1 in 200, or 1/4 the chance for a screen ~1/4 the width.
      if (
        !gameEnded &&
        Math.round(randomBetween(0, 100 / (canvasWidth / 800))) === 0
      ) {
        spaceAsteroids.push(
          makeSpaceAsteroid(
            appState,
            lander.getVelocity,
            lander.getDisplayPosition,
            onAsteroidImpact
          )
        );
      }
    }

    // Retired and drawn outside the altitude gate above. Gating the update as
    // well as the spawn froze every space asteroid when the lander descended
    // and popped them back in at their old positions on the way up, and
    // nothing was ever removed from the array while the player stayed high.
    spaceAsteroids = spaceAsteroids.filter((a) => !a.isFinished());
    spaceAsteroids.forEach((a) => a.draw(deltaTime));

    // Move asteroids as lander flies high
    CTX.save();
    CTX.translate(0, terrainOffset);
    if (sendAsteroid && timeSinceStart > asteroidCountdown) {
      asteroids.forEach((a) => a.draw(deltaTime, terrainOffset));
    }
    CTX.restore();

    if (randomConfetti.length > 0) {
      randomConfetti.forEach((c) => c.draw(deltaTime));
    }

    forceControls.update();
    lander.draw(timeSinceStart, deltaTime);
  } else {
    toyLander.draw(deltaTime);

    toyLanderControls.drawTouchOverlay();
  }
});

// PASSED FUNCTIONS

function onCloseInstructions() {
  toyLanderControls.detachEventListeners();
  gameControls().attachEventListeners();
  // The clock starts when the page loads, so without this a first-time
  // player's duration includes all the time they spent in the tutorial.
  animationObject.resetStartTime();
  challengeManager.populateCornerInfo();
  terrain.setShowLandingSurfaces();
}

function onGameEnd(data) {
  gameEnded = true;
  gameControls().detachEventListeners();
  bonusPointsManager.hide();

  const finalScore = data.landerScore + bonusPointsManager.getTotalPoints();
  const scoreDescription = data.landed
    ? data.hoverslam
      ? hoverslamDescription
      : landingScoreDescription(finalScore)
    : data.struckByAsteroid
    ? destroyedDescription()
    : crashScoreDescription(finalScore);
  const scoreForDisplay = formatNumber(finalScore, 1);

  showStatsAndResetControl(
    appState,
    animationObject,
    { ...data, scoreDescription, scoreForDisplay },
    landerControls.getHasKeyboard(),
    onResetGame
  );

  if (data.landed) {
    audioManager.playLanding();
    tally.storeLanding();
  } else {
    audioManager.playCrash();
    tally.storeCrash();
  }

  tally.updateDisplay();
}

function onResetGame() {
  resetRoundState();
}

function resetRoundState() {
  gameEnded = false;

  // Both are detached in case the controls setting changed since they were
  // attached
  if (instructions.hasClosedInstructions()) {
    landerControls.detachEventListeners();
    forceControls.detachEventListeners();
    gameControls().attachEventListeners();
  }

  seededRandom.setDailyChallengeSeed();
  randomConfetti = [];
  terrain.reGenerate();
  lander.updateLandingData();
  lander.resetProps();
  stars.reGenerate();
  sendAsteroid = seededRandomBool(asteroidRandom);
  asteroidCountdown = seededRandomBetween(2000, 15000, asteroidRandom);
  asteroids = [
    makeAsteroid(appState, lander.getDisplayPosition, onAsteroidImpact),
  ];
  spaceAsteroids = [];
  bonusPointsManager.reset();
}

function onAsteroidImpact(asteroidVelocity) {
  if (!lander.hasShield()) lander.destroy(asteroidVelocity);
}

// EXTRAS

document.addEventListener("keydown", ({ key }) => {
  if (key === "c") {
    randomConfetti.push(
      makeConfetti(appState, 10, {
        x: randomBetween(0, canvasWidth),
        y: randomBetween(0, canvasHeight),
      })
    );
  }
});

document.addEventListener("keydown", ({ key }) => {
  if (key === "m") {
    sendAsteroid = true;
    asteroidCountdown = 0;
    asteroids.push(
      makeAsteroid(appState, lander.getDisplayPosition, onAsteroidImpact)
    );
  }
});

document.addEventListener("keydown", ({ key }) => {
  if (key === "x") {
    asteroids.forEach((a) => a.destroy());
    spaceAsteroids.forEach((a) => a.destroy());
  }
});

document.addEventListener("keydown", ({ key, metaKey }) => {
  if (key === "z" && metaKey) {
    lander.activateShield();
  }
});
