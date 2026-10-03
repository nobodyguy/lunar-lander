import {
  randomBetween,
  seededRandomBetween,
  randomBool,
  getVectorVelocity,
  velocityInMPH,
  getAngleDeltaUpright,
  getAngleDeltaUprightWithSign,
  heightInFeet,
  formatSpeed,
  formatHeight,
  formatHeightCompact,
  UNIT_SYSTEMS,
  percentProgress,
  formatDuration,
  formatNumber,
  fillTextTabular,
  framesOfBurnSlack,
} from "../helpers/helpers.js";
import {
  scoreLanding,
  scoreCrash,
  isHoverslam,
} from "../helpers/scoring.js";
import {
  LANDER_WIDTH,
  LANDER_HEIGHT,
  INTERVAL,
  TRANSITION_TO_SPACE,
  HOVERSLAM_RELEASE_GRACE_MS,
  ROTATION_FUEL_RATE,
} from "../helpers/constants.js";
import { DISTURBANCE, ENGINE_CUTOUT } from "../helpers/rules.js";
import { makeLanderExplosion } from "./explosion.js";
import { makeConfetti } from "./confetti.js";
import { drawTrajectory } from "./trajectory.js";
import {
  transition,
  clampedProgress,
  easeInOutSine,
} from "../helpers/helpers.js";

export const makeLander = (state, onGameEnd) => {
  const CTX = state.get("CTX");
  const canvasWidth = state.get("canvasWidth");
  const canvasHeight = state.get("canvasHeight");
  const audioManager = state.get("audioManager");
  const bonusPointsManager = state.get("bonusPointsManager");
  const settings = state.get("settings");
  // Gravity, touchdown tolerances, fuel and the rest, as set by the controls
  // and difficulty settings
  const rules = state.get("rules");

  // Use grounded height to approximate distance from ground
  let _landingData = state.get("terrain").getLandingData();
  let _groundedHeight =
    _landingData.terrainAvgHeight - LANDER_HEIGHT + LANDER_HEIGHT / 2;
  const _thrust = 0.012;
  // The force sensor gives a variable throttle. The keyboard and touch
  // controls leave both of these at _thrust.
  let _engineThrust = _thrust;
  let _maxEngineThrust = _thrust;
  // Set while the force sensor's autopilot is flying the steering thrusters
  let _autopilot = null;
  let _rotationCommand = 0;

  let _position;
  let _displayPosition;
  let _velocity;
  let _rotationVelocity;
  let _angle;
  let _engineOn;
  let _rotatingLeft;
  let _rotatingRight;
  let _shieldActive;
  // The share of the tank left, 0–1, so it reads the same whatever the size
  let _fuel;
  let _nextDisturbanceAt;
  let _disturbanceShownUntil;
  // A cutout leaves _engineOn alone, so it never reads as the player letting
  // go: engine starts, hoverslams and the sound all stay the player's own
  let _nextCutoutAt;
  let _cutoutUntil;

  let _timeSinceStart;
  let gameEndData;
  let _gameEndConfetti;
  let _gameEndExplosion;
  let _flipConfetti;
  let _lastRotation;
  let _lastRotationAngle;
  let _rotationCount;
  let _maxVelocity;
  let _velocityMilestone;
  let _maxHeight;
  let _heightMilestone;
  let _babySoundPlayed;
  let _engineActivations;
  let _firstBurnSlackFrames;
  let _engineOffAt;
  let _engineHeldToTouchdown;

  const resetProps = () => {
    const seededRandom = state.get("seededRandom").getStream("lander");

    _position = {
      x: seededRandomBetween(
        canvasWidth * 0.33,
        canvasWidth * 0.66,
        seededRandom
      ),
      y: LANDER_HEIGHT * 2,
    };
    _displayPosition = { ..._position };
    _velocity = {
      x: seededRandomBetween(
        -_thrust * (canvasWidth / 10),
        _thrust * (canvasWidth / 10),
        seededRandom
      ),
      y: seededRandomBetween(0, _thrust * (canvasWidth / 10), seededRandom),
    };
    _rotationVelocity = seededRandomBetween(-0.2, 0.2, seededRandom);
    _angle = seededRandomBetween(Math.PI * 1.5, Math.PI * 2.5, seededRandom);
    _engineOn = false;
    _rotatingLeft = false;
    _rotatingRight = false;
    _shieldActive = false;
    _fuel = 1;
    _rotationCommand = 0;
    _nextDisturbanceAt = _disturbanceInterval();
    _disturbanceShownUntil = 0;
    _nextCutoutAt = _cutoutInterval();
    _cutoutUntil = 0;
    _autopilot?.reset();

    _timeSinceStart = 0;
    gameEndData = false;
    _gameEndConfetti = false;
    _gameEndExplosion = false;
    _flipConfetti = [];
    _lastRotation = 1;
    _lastRotationAngle = Math.PI * 2;
    _rotationCount = 0;
    _maxVelocity = { ..._velocity };
    _velocityMilestone = { x: 0, y: 0 };
    _maxHeight = _position.y;
    _heightMilestone = 0;
    _babySoundPlayed = false;
    _engineActivations = 0;
    _firstBurnSlackFrames = null;
    _engineOffAt = null;
    _engineHeldToTouchdown = false;
  };
  function _disturbanceInterval() {
    return randomBetween(DISTURBANCE.minIntervalMs, DISTURBANCE.maxIntervalMs);
  }
  function _cutoutInterval() {
    return randomBetween(
      ENGINE_CUTOUT.minIntervalMs,
      ENGINE_CUTOUT.maxIntervalMs
    );
  }

  resetProps();

  const _isCutOut = () => _timeSinceStart < _cutoutUntil;
  const _engineFiring = () => _engineOn && !_isCutOut();

  const _isFixedPositionInSpace = () => _position.y < 0;

  // Only drained while the setting is on, so switching it off and back on
  // mid-flight can't be used to refill the tank
  const _fuelLimited = () => Number.isFinite(rules().fuelCapacity);
  const _hasFuel = () => !_fuelLimited() || _fuel > 0;
  const _fuelPercent = () => Math.ceil(_fuel * 100);

  // The main engine burns in proportion to its thrust, so with the force
  // sensor a hover costs the same fuel whatever the mapping settings are
  const _burnFuel = (deltaTime) => {
    if (!_fuelLimited()) return;

    const steering = _autopilot
      ? Math.abs(_rotationCommand)
      : (_rotatingLeft ? 1 : 0) + (_rotatingRight ? 1 : 0);
    const rate =
      (_engineFiring() ? _engineThrust / _thrust : 0) +
      steering * ROTATION_FUEL_RATE;
    _fuel = Math.max(0, _fuel - (rate * deltaTime) / rules().fuelCapacity);

    if (_fuel === 0 && rate > 0) {
      if (_engineOn) _engineOffAt = _timeSinceStart;
      _engineOn = false;
      _rotatingLeft = false;
      _rotatingRight = false;
      _rotationCommand = 0;
      audioManager.stopEngineSound();
      audioManager.stopBoosterSound1();
      audioManager.stopBoosterSound2();
    }
  };

  // How much longer the player could have coasted at this instant before the
  // engine had to come on. Sampled when the engine is first started, to judge
  // whether the burn was left as late as a hoverslam demands.
  const _burnSlackFrames = () => {
    // Thrust points along the lander's axis, so sideways drift can't be shed on
    // the way down — it eats into the survivable touchdown speed budget
    const { crashVelocity, gravity } = rules();
    const safeSpeed = Math.sqrt(
      Math.max(0, Math.pow(crashVelocity, 2) - Math.pow(_velocity.x, 2))
    );

    return framesOfBurnSlack({
      altitude: _groundedHeight - _position.y,
      descentSpeed: _velocity.y,
      safeSpeed,
      thrust: _maxEngineThrust,
      gravity,
    });
  };

  const _setGameEndData = (landed, struckByAsteroid = false) => {
    // Infinity means no burn was ever needed, -Infinity that the window was
    // hopelessly closed. Neither is meaningful to display, but both still
    // compare correctly against the slack bound in isHoverslam.
    const burnSlackMs =
      _firstBurnSlackFrames === null ? null : _firstBurnSlackFrames * INTERVAL;
    const { crashVelocity, crashAngle } = rules();

    gameEndData = {
      landed,
      struckByAsteroid,
      speedMph: velocityInMPH(_velocity),
      angle: formatNumber(getAngleDeltaUpright(_angle), 1),
      duration: formatDuration(_timeSinceStart),
      durationMs: Math.round(_timeSinceStart),
      rotationsInt: _rotationCount,
      rotationsFormatted: formatNumber(_rotationCount),
      maxSpeedMph: velocityInMPH(_maxVelocity),
      maxHeightFt: heightInFeet(_maxHeight, _groundedHeight),
      fuelPercent: _fuelLimited() ? _fuelPercent() : null,
      speedPercent: percentProgress(
        0,
        crashVelocity,
        getVectorVelocity(_velocity)
      ),
      anglePercent: percentProgress(
        0,
        crashAngle,
        getAngleDeltaUpright(_angle)
      ),
      engineActivations: _engineActivations,
      engineActivationsFormatted: formatNumber(_engineActivations),
      burnSlackMs:
        burnSlackMs !== null && Number.isFinite(burnSlackMs)
          ? Math.round(burnSlackMs)
          : null,
      hoverslam: isHoverslam({
        landed,
        struckByAsteroid,
        engineActivations: _engineActivations,
        engineHeldToTouchdown: _engineHeldToTouchdown,
        burnSlackMs,
      }),
    };

    if (landed) {
      const score = scoreLanding(
        getAngleDeltaUpright(_angle),
        getVectorVelocity(_velocity),
        { crashVelocity, crashAngle }
      );

      gameEndData.landerScore = score;

      _gameEndConfetti = makeConfetti(state, Math.round(score));

      _angle = Math.PI * 2;
      _velocity = { x: 0, y: 0 };
      _rotationVelocity = 0;
    } else {
      const score = scoreCrash(
        getAngleDeltaUpright(_angle),
        getVectorVelocity(_velocity),
        { crashVelocity, crashAngle }
      );

      gameEndData.landerScore = score;

      _gameEndExplosion = makeLanderExplosion(
        state,
        _isFixedPositionInSpace() ? _displayPosition : _position,
        _velocity,
        _angle,
        !_isFixedPositionInSpace()
      );

      _velocity = { x: 0, y: 0 };
    }

    DD_RUM.onReady(() => {
      DD_RUM.addAction("score", {
        score: gameEndData.landerScore,
        landed: !!landed,
        speed: formatSpeed(gameEndData.speedMph, "imperial"),
        angle: gameEndData.angle,
        duration: gameEndData.durationMs,
        flips: gameEndData.rotationsInt,
        maxSpeed: formatSpeed(gameEndData.maxSpeedMph, "imperial"),
        maxHeight: formatHeight(gameEndData.maxHeightFt, "imperial"),
        fuelPercent: gameEndData.fuelPercent,
        engineActivations: gameEndData.engineActivations,
        burnSlackMs: gameEndData.burnSlackMs,
        hoverslam: gameEndData.hoverslam,
        controls: settings.get("controls"),
        difficulty:
          settings.get("controls") === "force"
            ? settings.get("difficulty")
            : null,
      });
    });

    onGameEnd(gameEndData);
  };

  const destroy = (asteroidVelocity) => {
    if (!gameEndData) {
      const averageXVelocity = (_velocity.x + asteroidVelocity.x) / 2;
      const averageYVelocity = (_velocity.y + asteroidVelocity.y) / 2;
      _velocity = _isFixedPositionInSpace()
        ? { x: averageXVelocity, y: asteroidVelocity.y / 2 }
        : { x: averageXVelocity, y: averageYVelocity };
      _engineOn = false;
      _rotatingLeft = false;
      _rotatingRight = false;
      audioManager.stopEngineSound();
      audioManager.stopBoosterSound1();
      audioManager.stopBoosterSound2();
      _rotationCommand = 0;
      _setGameEndData(false, true);
    }
  };

  const _updateProps = (deltaTime) => {
    const deltaTimeMultiplier = deltaTime / INTERVAL;

    _position.y = _position.y + deltaTimeMultiplier * _velocity.y;

    const landerInTerrain = CTX.isPointInPath(
      _landingData.terrainPath2D,
      _position.x * state.get("scaleFactor"),
      (_position.y + LANDER_HEIGHT / 2) * state.get("scaleFactor")
    );

    const landerUnderTerrain = _position.y >= canvasHeight;

    if (!landerInTerrain && !landerUnderTerrain) {
      const { gravity } = rules();

      // The autopilot drives the steering thrusters proportionally. Their
      // flames only show for a firm command, so small trims don't flicker.
      if (_autopilot && rules().autopilot && _hasFuel()) {
        _rotationCommand = _autopilot.update(
          {
            position: _position,
            velocity: _velocity,
            angle: _angle,
            rotationVelocity: _rotationVelocity,
          },
          rules().autopilot
        );
        _rotatingRight = _rotationCommand > 0.25;
        _rotatingLeft = _rotationCommand < -0.25;
        _rotationVelocity += deltaTimeMultiplier * 0.01 * _rotationCommand;
      } else {
        // Update ballistic properties
        if (_rotatingRight) _rotationVelocity += deltaTimeMultiplier * 0.01;
        if (_rotatingLeft) _rotationVelocity -= deltaTimeMultiplier * 0.01;
      }

      _applyDisturbance();
      _applyEngineCutout();

      _position.x += deltaTimeMultiplier * _velocity.x;
      _position.x = ((_position.x % canvasWidth) + canvasWidth) % canvasWidth;
      _angle += deltaTimeMultiplier * ((Math.PI / 180) * _rotationVelocity);
      _velocity.y += deltaTimeMultiplier * gravity;
      _displayPosition.x = _position.x;

      if (_engineFiring()) {
        _velocity.x += deltaTimeMultiplier * (_engineThrust * Math.sin(_angle));
        _velocity.y -= deltaTimeMultiplier * (_engineThrust * Math.cos(_angle));
      }

      _burnFuel(deltaTime);

      // Log new rotations
      const uprightRotations = Math.floor((_angle + Math.PI) / (Math.PI * 2));
      if (
        Math.abs(_angle - _lastRotationAngle) > Math.PI * 2 &&
        uprightRotations != _lastRotation
      ) {
        const rotationDifference = Math.abs(uprightRotations - _lastRotation);

        bonusPointsManager.addNamedPoints("newRotation", rotationDifference);
        _rotationCount += rotationDifference;
        _lastRotation = uprightRotations;
        _lastRotationAngle = _angle;

        _flipConfetti.push(
          makeConfetti(
            state,
            10,
            _displayPosition,
            _position.y > 0 ? _velocity : { x: _velocity.x, y: 0 }
          )
        );
      }

      // Log new max speed and height
      if (_position.y < _maxHeight) _maxHeight = _position.y;

      if (getVectorVelocity(_velocity) > getVectorVelocity(_maxVelocity)) {
        _maxVelocity = { ..._velocity };
      }

      // Record bonus points for increments of height and speed
      // Ints here are pixels / raw values, not display units
      if (
        _position.y <
        _heightMilestone + Math.min(-3500, _heightMilestone * 3)
      ) {
        _heightMilestone = _position.y;
        bonusPointsManager.addNamedPoint("newHeight");
      }

      if (
        getVectorVelocity(_velocity) >
        getVectorVelocity(_velocityMilestone) + 10
      ) {
        _velocityMilestone = { ..._velocity };
        bonusPointsManager.addNamedPoint("newSpeed");
      }

      // Play easter egg baby sound
      if (getVectorVelocity(_velocity) > 20 && !_babySoundPlayed) {
        state.get("audioManager").playBaby();
        _babySoundPlayed = true;
      } else if (getVectorVelocity(_velocity) < 20 && _babySoundPlayed) {
        _babySoundPlayed = false;
      }
    } else if (!gameEndData) {
      // Must be read before the engine is force-cleared just below, which
      // happens well before _setGameEndData runs. The grace window covers a
      // finger that lifted a frame or two early. Note this branch and destroy()
      // both assign _engineOn directly rather than calling engineOff(), so
      // neither is mistaken for the player releasing.
      _engineHeldToTouchdown =
        _engineOn ||
        (_engineOffAt !== null &&
          _timeSinceStart - _engineOffAt <= HOVERSLAM_RELEASE_GRACE_MS);

      _engineOn = false;
      _rotatingLeft = false;
      _rotatingRight = false;
      audioManager.stopEngineSound();
      audioManager.stopBoosterSound1();
      audioManager.stopBoosterSound2();
      _rotationCommand = 0;

      const { crashVelocity, crashAngle } = rules();
      const landingArea = _landingData.landingSurfaces.find(
        ({ x, width }) =>
          _position.x - LANDER_WIDTH / 2 >= x &&
          _position.x + LANDER_WIDTH / 2 <= x + width
      );

      const didLand =
        getVectorVelocity(_velocity) < crashVelocity &&
        getAngleDeltaUpright(_angle) < crashAngle &&
        landingArea;

      if (didLand) bonusPointsManager.addNamedPoint(landingArea.name);

      _setGameEndData(didLand);
    }
  };

  // A sudden push in position and rotation, on difficulties that have them.
  // Held off near the ground, where the autopilot is levelling out for
  // touchdown and has no tilt left to correct with.
  const _applyDisturbance = () => {
    if (!rules().disturbances || _timeSinceStart < _nextDisturbanceAt) return;

    _nextDisturbanceAt = _timeSinceStart + _disturbanceInterval();
    const altitude =
      state.get("terrain").getGroundHeightAtX(_position.x) -
      (_position.y + LANDER_HEIGHT / 2);
    if (altitude < DISTURBANCE.minAltitude) return;

    const direction = () => (randomBool() ? 1 : -1);
    _velocity.x += direction() * randomBetween(0.5, 1) * DISTURBANCE.maxPush;
    _rotationVelocity +=
      direction() * randomBetween(0.5, 1) * DISTURBANCE.maxSpin;
    _disturbanceShownUntil = _timeSinceStart + 900;
  };

  // Due cutouts wait for the engine to be on and the lander well clear of
  // the ground, then the engine dies for a moment
  const _applyEngineCutout = () => {
    if (
      !rules().engineCutouts ||
      !_engineOn ||
      _isCutOut() ||
      _timeSinceStart < _nextCutoutAt
    ) {
      return;
    }

    const altitude =
      state.get("terrain").getGroundHeightAtX(_position.x) -
      (_position.y + LANDER_HEIGHT / 2);
    if (altitude < ENGINE_CUTOUT.minAltitude) return;

    _cutoutUntil =
      _timeSinceStart +
      randomBetween(ENGINE_CUTOUT.minDurationMs, ENGINE_CUTOUT.maxDurationMs);
    _nextCutoutAt = _cutoutUntil + _cutoutInterval();
  };

  const _fuelColor = () =>
    _fuelPercent() <= 20 ? "rgb(255, 0, 0)" : state.get("theme").infoFontColor;

  const _fuelText = () => (_fuel > 0 ? `FUEL ${_fuelPercent()}%` : "NO FUEL");

  const _hudFont = "400 10px -apple-system, BlinkMacSystemFont, sans-serif";

  // Measured from the ground under the lander rather than _groundedHeight, the
  // average terrain line. Landing pads always sit at or below that average, so
  // against it every touchdown read as a negative height.
  const _altitudeInFeet = () =>
    Math.max(
      0,
      heightInFeet(
        _position.y + LANDER_HEIGHT / 2,
        state.get("terrain").getGroundHeightAtX(_position.x)
      )
    );

  // Hard mode's surprises, for both HUDs, most urgent first
  const _warnings = () =>
    [
      _isCutOut() && ["ENGINE FAIL", "rgb(255, 60, 60)"],
      _timeSinceStart < _disturbanceShownUntil && ["GUST", "rgb(255, 170, 0)"],
    ].filter(Boolean);

  const _drawHUD = () => {
    const units = settings.get("units");
    const { speedLabel, heightLabel } = UNIT_SYSTEMS[units];

    CTX.save();
    CTX.font = _hudFont;
    const textWidth = CTX.measureText(`100.0 ${speedLabel}`).width + 2;
    const xPosBasis =
      Math.abs(_velocity.x) > 6
        ? canvasWidth / 2 - textWidth / 2
        : Math.min(_position.x + LANDER_WIDTH * 2, canvasWidth - textWidth);
    const yPosBasis = Math.max(_position.y, TRANSITION_TO_SPACE);
    const lineHeight = 14;
    const rotatingLeft = _rotationVelocity < 0;
    const { crashVelocity, crashAngle } = rules();
    const speedColor =
      getVectorVelocity(_velocity) > crashVelocity
        ? "rgb(255, 0, 0)"
        : "rgb(0, 255, 0)";
    const angleColor =
      getAngleDeltaUpright(_angle) > crashAngle
        ? "rgb(255, 0, 0)"
        : "rgb(0, 255, 0)";

    // Draw HUD text
    CTX.fillStyle = speedColor;
    CTX.fillText(
      `${formatSpeed(velocityInMPH(_velocity), units)} ${speedLabel}`,
      xPosBasis,
      yPosBasis - lineHeight
    );
    CTX.fillStyle = angleColor;
    CTX.fillText(
      `${getAngleDeltaUprightWithSign(_angle).toFixed(1)}°`,
      xPosBasis,
      yPosBasis
    );
    CTX.fillStyle = state.get("theme").infoFontColor;
    CTX.fillText(
      `${formatHeight(_altitudeInFeet(), units)} ${heightLabel}`,
      xPosBasis,
      yPosBasis + lineHeight
    );
    if (_fuelLimited()) {
      CTX.fillStyle = _fuelColor();
      CTX.fillText(_fuelText(), xPosBasis, yPosBasis + lineHeight * 2);
    }
    _warnings().forEach(([text, color], index) => {
      CTX.fillStyle = color;
      CTX.fillText(
        text,
        xPosBasis,
        yPosBasis + lineHeight * ((_fuelLimited() ? 3 : 2) + index)
      );
    });

    // Draw hud rotation direction arrow
    const arrowHeight = 7;
    const arrowWidth = 6;
    const arrowTextMargin = 3;
    const arrowVerticalOffset = -3;
    if (rotatingLeft) {
      CTX.save();
      CTX.strokeStyle = angleColor;
      CTX.beginPath();
      CTX.moveTo(
        xPosBasis - arrowWidth - arrowTextMargin,
        yPosBasis + arrowVerticalOffset
      );
      CTX.lineTo(
        xPosBasis - arrowTextMargin,
        yPosBasis + arrowVerticalOffset - arrowHeight / 2
      );
      CTX.lineTo(
        xPosBasis - arrowTextMargin,
        yPosBasis + arrowVerticalOffset + arrowHeight / 2
      );
      CTX.closePath();
      CTX.stroke();
      CTX.restore();
    } else {
      CTX.save();
      CTX.strokeStyle = angleColor;
      CTX.beginPath();
      CTX.moveTo(
        xPosBasis - arrowWidth - arrowTextMargin,
        yPosBasis + arrowVerticalOffset - arrowHeight / 2
      );
      CTX.lineTo(xPosBasis - arrowTextMargin, yPosBasis + arrowVerticalOffset);
      CTX.lineTo(
        xPosBasis - arrowWidth - arrowTextMargin,
        yPosBasis + arrowVerticalOffset + arrowHeight / 2
      );
      CTX.closePath();
      CTX.stroke();
      CTX.restore();
    }

    CTX.restore();
  };

  const _drawBottomHUD = () => {
    const units = settings.get("units");
    const { speedLabel, heightLabel } = UNIT_SYSTEMS[units];
    const yPadding = LANDER_HEIGHT;
    const xPadding = LANDER_HEIGHT;
    const { gravity } = rules();

    const fallDistance = _landingData.terrainAvgHeight - _position.y;
    const discriminant = _velocity.y ** 2 + 2 * gravity * fallDistance;
    const secondsUntilTerrain =
      _velocity.y > 0 && discriminant >= 0
        ? Math.round(
            (Math.sqrt(discriminant) - _velocity.y) / ((1000 / INTERVAL) * gravity)
          )
        : 99;

    const _drawReadout = (value, label, xPos, baselineY) => {
      CTX.letterSpacing = "0px";
      CTX.font = "800 24px/1.5 -apple-system, BlinkMacSystemFont, sans-serif";
      fillTextTabular(CTX, value, xPos, baselineY - 24);

      CTX.letterSpacing = "1px";
      CTX.font = "400 16px/1.5 -apple-system, BlinkMacSystemFont, sans-serif";
      CTX.fillText(label, xPos, baselineY);
    };

    CTX.save();

    CTX.fillStyle = state.get("theme").infoFontColor;

    CTX.textAlign = "left";
    _drawReadout(
      formatSpeed(velocityInMPH(_velocity), units, 0),
      speedLabel,
      xPadding,
      canvasHeight - yPadding
    );

    CTX.textAlign = "right";
    _drawReadout(
      formatHeightCompact(_altitudeInFeet(), units),
      heightLabel,
      canvasWidth - xPadding,
      canvasHeight - yPadding
    );

    CTX.textAlign = "center";
    if (_fuelLimited()) {
      CTX.save();
      CTX.fillStyle = _fuelColor();
      CTX.letterSpacing = "1px";
      CTX.font = "400 16px/1.5 -apple-system, BlinkMacSystemFont, sans-serif";
      CTX.fillText(_fuelText(), canvasWidth / 2, canvasHeight - yPadding - 56);
      CTX.restore();
    }

    // Stacked above the fuel readout, or where it would be
    _warnings().forEach(([text, color], index) => {
      CTX.save();
      CTX.fillStyle = color;
      CTX.letterSpacing = "1px";
      CTX.font = "600 16px/1.5 -apple-system, BlinkMacSystemFont, sans-serif";
      CTX.fillText(
        text,
        canvasWidth / 2,
        canvasHeight - yPadding - (_fuelLimited() ? 80 : 56) - index * 24
      );
      CTX.restore();
    });

    if (secondsUntilTerrain < 20) {
      CTX.fillStyle = "rgb(255, 0, 0)";
      _drawReadout(
        formatNumber(secondsUntilTerrain),
        "SECONDS UNTIL TERRAIN",
        canvasWidth / 2,
        canvasHeight - yPadding
      );
    } else {
      _drawReadout(
        formatDuration(_timeSinceStart),
        "DURATION",
        canvasWidth / 2,
        canvasHeight - yPadding
      );
    }

    CTX.restore();
  };

  const _drawLander = () => {
    CTX.save();

    // The lander position is handled differently in two "altitude zones"
    // Zone 1:
    //   The lander is close to the ground - the viewport is static, and the
    //   terrain is visible. The _position is the same as the display position
    // Zone 2:
    //   The lander has transitioned to space, and over the course of two
    //   viewport heights, it's moved linearly to the center of the screen

    // Zone 1 positioning
    CTX.translate(
      _position.x,
      _position.y < TRANSITION_TO_SPACE ? TRANSITION_TO_SPACE : _position.y
    );

    _displayPosition.y =
      _position.y < TRANSITION_TO_SPACE ? TRANSITION_TO_SPACE : _position.y;

    // Zone 2 positioning
    if (_isFixedPositionInSpace()) {
      const yPosTransition = transition(
        0,
        canvasHeight / 2 - TRANSITION_TO_SPACE,
        clampedProgress(0, -canvasHeight * 2, _position.y),
        easeInOutSine
      );

      CTX.translate(0, yPosTransition);
      _displayPosition.y += yPosTransition;
    }

    CTX.rotate(_angle);

    // Draw the lander
    //
    // We want the center of rotation to be in the center of the bottom
    // rectangle, excluding the tip of the lander. To accomplish this, the
    // lander is drawn offset to the top and left of _position.x and y.
    // The tip is also drawn offset to the top of that so that the lander
    // is a bit taller than LANDER_HEIGHT.
    //
    //                                      /\
    //                                     /  \
    // Start at top left of this segment → |  |
    // and work clockwise.                 |__|
    CTX.beginPath();
    CTX.moveTo(-LANDER_WIDTH / 2, -LANDER_HEIGHT / 2);
    CTX.lineTo(0, -LANDER_HEIGHT);
    CTX.lineTo(LANDER_WIDTH / 2, -LANDER_HEIGHT / 2);
    CTX.lineTo(LANDER_WIDTH / 2, LANDER_HEIGHT / 2);
    CTX.lineTo(-LANDER_WIDTH / 2, LANDER_HEIGHT / 2);
    CTX.closePath();
    CTX.fillStyle = state.get("theme").landerGradient;
    CTX.fill();

    // Translate to the top-left corner of the lander so engine and booster
    // flames can be drawn from 0, 0
    CTX.translate(-LANDER_WIDTH / 2, -LANDER_HEIGHT / 2);

    if (_engineOn || _rotatingLeft || _rotatingRight) {
      CTX.fillStyle = randomBool() ? "#415B8C" : "#F3AFA3";
    }

    // Main engine flame. During a cutout it only sputters: a stub of flame
    // on the odd frame, so it reads as a failing engine, not a released one.
    const sputtering = _isCutOut();
    if (_engineOn && (!sputtering || randomBool(0.85))) {
      // Scaled by the throttle, which is always full without the force sensor
      const _flameHeight = sputtering
        ? randomBetween(3, 10)
        : randomBetween(10, 50) *
          (0.25 + 0.75 * Math.min(1, _engineThrust / _maxEngineThrust));
      const _flameMargin = 3;
      CTX.beginPath();
      CTX.moveTo(_flameMargin, LANDER_HEIGHT);
      CTX.lineTo(LANDER_WIDTH - _flameMargin, LANDER_HEIGHT);
      CTX.lineTo(LANDER_WIDTH / 2, LANDER_HEIGHT + _flameHeight);
      CTX.closePath();
      CTX.fill();
    }

    const _boosterLength = randomBetween(5, 25);
    // Right booster flame
    if (_rotatingLeft) {
      CTX.beginPath();
      CTX.moveTo(LANDER_WIDTH, 0);
      CTX.lineTo(LANDER_WIDTH + _boosterLength, LANDER_HEIGHT * 0.05);
      CTX.lineTo(LANDER_WIDTH, LANDER_HEIGHT * 0.1);
      CTX.closePath();
      CTX.fill();
    }

    // Left booster flame
    if (_rotatingRight) {
      CTX.beginPath();
      CTX.moveTo(0, 0);
      CTX.lineTo(-_boosterLength, LANDER_HEIGHT * 0.05);
      CTX.lineTo(0, LANDER_HEIGHT * 0.1);
      CTX.closePath();
      CTX.fill();
    }

    if (_shieldActive) {
      CTX.strokeStyle = "#1e00e2";
      CTX.lineWidth = 2;
      CTX.translate(LANDER_WIDTH / 2, LANDER_HEIGHT / 3);
      CTX.beginPath();
      CTX.arc(0, 0, LANDER_WIDTH * 2.5, 0, 2 * Math.PI);
      CTX.stroke();
    }

    CTX.restore();
  };

  const draw = (timeSinceStart, deltaTime) => {
    _timeSinceStart = timeSinceStart;

    if (!gameEndData) {
      _updateProps(deltaTime);

      if (_position.y > TRANSITION_TO_SPACE) {
        drawTrajectory(state, _position, _angle, _velocity, _rotationVelocity);
      }
    }

    if (_flipConfetti.length > 0)
      _flipConfetti.forEach((c) => c.draw(deltaTime));

    if (_gameEndConfetti) _gameEndConfetti.draw(deltaTime);

    if (_gameEndExplosion) _gameEndExplosion.draw(deltaTime);

    if (!gameEndData || (gameEndData && gameEndData.landed)) _drawLander();

    // Draw speed and angle text beside lander, even after crashing
    if (_position.y > TRANSITION_TO_SPACE) {
      _drawHUD();
    } else if (!gameEndData) {
      CTX.save();
      const animateHUDProgress = clampedProgress(
        LANDER_HEIGHT,
        -LANDER_HEIGHT,
        _position.y
      );
      CTX.globalAlpha = transition(0, 1, animateHUDProgress, easeInOutSine);
      CTX.translate(0, transition(16, 0, animateHUDProgress, easeInOutSine));
      _drawBottomHUD();
      CTX.restore();
    }
  };

  const updateLandingData = () => {
    _landingData = state.get("terrain").getLandingData();
    _groundedHeight = _landingData.terrainAvgHeight - LANDER_HEIGHT + LANDER_HEIGHT / 2;
  }

  return {
    draw,
    destroy,
    resetProps,
    updateLandingData,
    getPosition: () => _position,
    getDisplayPosition: () => _displayPosition,
    getVelocity: () => _velocity,
    activateShield: () => (_shieldActive = true),
    hasShield: () => _shieldActive,
    // Only off→on transitions count as an activation. Keydown has no repeat
    // guard, and multi-touch or a finger sliding between columns can re-fire the
    // center zone, so a held engine would otherwise register hundreds of starts.
    // These return false when the tank is empty, so the controls know to keep
    // the thruster sounds off
    engineOn: () => {
      if (!_hasFuel()) return false;
      if (_engineOn || gameEndData) return;
      _engineOn = true;
      if (++_engineActivations === 1) {
        _firstBurnSlackFrames = _burnSlackFrames();
      }
    },
    engineOff: () => {
      if (!_engineOn) return;
      _engineOn = false;
      _engineOffAt = _timeSinceStart;
    },
    // The engine's thrust while on, and the most it can give, as accelerations
    // in pixels per frame². Only the force sensor changes these.
    setEngineThrust: (thrust, maxThrust) => {
      _engineThrust = thrust;
      _maxEngineThrust = maxThrust;
    },
    resetEngineThrust: () => {
      _engineThrust = _thrust;
      _maxEngineThrust = _thrust;
    },
    setAutopilot: (autopilot) => {
      _autopilot = autopilot;
      _rotationCommand = 0;
      _rotatingLeft = false;
      _rotatingRight = false;
      autopilot?.reset();
    },
    getAutopilotTarget: () => (_autopilot ? _autopilot.getTarget() : null),
    isEngineCutOut: () => _isCutOut() && !gameEndData,
    rotateLeft: () => _hasFuel() && (_rotatingLeft = true),
    rotateRight: () => _hasFuel() && (_rotatingRight = true),
    stopLeftRotation: () => (_rotatingLeft = false),
    stopRightRotation: () => (_rotatingRight = false),
  };
};
