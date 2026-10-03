import { GRAVITY, INTERVAL } from "./helpers/constants.js";
import { randomBool } from "./helpers/helpers.js";

export const makeParticle = (
  state,
  startPosition,
  startVelocity,
  width,
  height,
  fill,
  customDraw = false,
  useTerrain = true,
  onCollide = () => {}
) => {
  const CTX = state.get("CTX");
  const terrain = state.get("terrain");
  const landingData = state.get("terrain").getLandingData();
  const gravity = GRAVITY;
  const friction = 0.3;
  const rotationDirection = randomBool();
  // Pieces collide as a circle a bit smaller than their drawn shape
  const radius = Math.sqrt(width ** 2 + height ** 2) / 3;

  let position = { ...startPosition };
  let positionLog = [];
  let velocity = {
    // Spread pieces sideways a little according to their starting direction
    x: startVelocity.x + Math.cos(Math.atan2(startVelocity.y, startVelocity.x)),
    y: startVelocity.y,
  };
  let rotationAngle = Math.PI * 2;
  let rotationVelocity = 0;
  let stopped = false;

  const update = (deltaTime) => {
    const deltaTimeMultiplier = deltaTime / INTERVAL;

    velocity.y += deltaTimeMultiplier * gravity;
    rotationVelocity += rotationDirection
      ? deltaTimeMultiplier * 0.1
      : deltaTimeMultiplier * -0.1;
    rotationAngle = (rotationAngle + rotationVelocity) * friction;

    let prospectiveNextPosition = {
      x: position.x + deltaTimeMultiplier * velocity.x,
      y: position.y + deltaTimeMultiplier * velocity.y,
    };

    if (
      useTerrain &&
      prospectiveNextPosition.y + radius >= landingData.terrainHeight
    ) {
      const contact = terrain.getSurfaceContact(prospectiveNextPosition);

      if (contact.distance < radius) {
        const { normal } = contact;
        const normalSpeed = velocity.x * normal.x + velocity.y * normal.y;

        // Bounce off the surface the piece actually touched, damping both the
        // bounce and the slide. Bouncing off the segment under whichever
        // sample point hit first sent pieces into the far side of peaks.
        if (normalSpeed < 0) {
          const slide = {
            x: velocity.x - normalSpeed * normal.x,
            y: velocity.y - normalSpeed * normal.y,
          };
          velocity = {
            x: slide.x * (1 - friction) - normalSpeed * friction * normal.x,
            y: slide.y * (1 - friction) - normalSpeed * friction * normal.y,
          };
        }

        // Push the piece back out of the ground along the normal. Without
        // this, a piece that ended a step underground collided on every
        // later step, never moved again and was left buried.
        const overlap = radius - contact.distance;
        prospectiveNextPosition = {
          x: prospectiveNextPosition.x + overlap * normal.x,
          y: prospectiveNextPosition.y + overlap * normal.y,
        };

        if (countSimilarCoordinates(positionLog) > 5) stopped = true;

        // Provide the point just prior to collision so particles reflect off
        // terrain rather than getting stuck in it
        onCollide(position, velocity);
      }

      // Track the last 20 positions to check for duplicates
      positionLog.push({ ...position });
      if (positionLog.length > 20) positionLog.shift();
    } else {
      positionLog = [];
    }

    position.x =
      position.x > state.get("canvasWidth")
        ? 0
        : position.x < 0
        ? state.get("canvasWidth")
        : prospectiveNextPosition.x;
    position.y = prospectiveNextPosition.y;
  };

  const draw = (deltaTime) => {
    if (!stopped) update(deltaTime);

    CTX.save();

    if (customDraw) {
      customDraw(
        CTX,
        position,
        velocity,
        rotationAngle,
        fill,
        rotationVelocity
      );
    } else {
      CTX.fillStyle = fill;
      CTX.translate(position.x, position.y);
      CTX.rotate(rotationAngle);
      CTX.fillRect(-width / 2, -height / 2, width, height);
    }

    CTX.restore();
  };

  return { draw, getPosition: () => position, getVelocity: () => velocity };
};

function countSimilarCoordinates(arr) {
  return (
    arr.length -
    new Set(arr.map(({ x, y }) => `${Math.round(x)}|${Math.round(y)}`)).size
  );
}
