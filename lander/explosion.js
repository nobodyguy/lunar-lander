import { randomBetween, jitterCoordinate } from "../helpers/helpers.js";
import { LANDER_WIDTH, LANDER_HEIGHT } from "../helpers/constants.js";
import { makeParticle } from "../particle.js";

export const makeExplosion = (
  state,
  position,
  velocity,
  fill,
  size,
  amount,
  useTerrain = true
) => {
  const smallExplosionChunks = new Array(amount)
    .fill()
    .map(() =>
      makeParticle(
        state,
        jitterCoordinate(position),
        jitterCoordinate(velocity),
        randomBetween(size / 4, size),
        randomBetween(size / 4, size),
        fill,
        false,
        useTerrain
      )
    );

  return {
    draw: (deltaTime) => smallExplosionChunks.forEach((e) => e.draw(deltaTime)),
  };
};

export const makeLanderExplosion = (
  state,
  position,
  velocity,
  angle,
  useTerrain = true
) => {
  const gradient = state.get("theme").landerGradient;

  // Where a piece offset along the lander's own (rotated) y axis sits
  const pieceStart = (offsetY) => ({
    x: position.x - offsetY * Math.sin(angle),
    y: position.y + offsetY * Math.cos(angle),
  });

  const noseCone = makeParticle(
    state,
    pieceStart(-LANDER_HEIGHT / 2 + 4),
    jitterCoordinate(velocity),
    LANDER_WIDTH,
    LANDER_HEIGHT / 2,
    gradient,
    (CTX, position, _, rotationAngle, fill) => {
      // Each piece starts where it sat in the intact lander and keeps the
      // lander's crash angle, spinning about its own centre on top of that.
      // Drawing the pieces offset from their particle position instead made
      // them collide somewhere other than where they were drawn, so they
      // rested half inside the ground.
      CTX.translate(position.x, position.y);
      CTX.rotate(angle);
      CTX.fillStyle = fill;
      CTX.rotate(rotationAngle);
      CTX.beginPath();
      CTX.moveTo(-LANDER_WIDTH / 2, LANDER_HEIGHT / 4 - 4);
      CTX.lineTo(0, -LANDER_HEIGHT / 4 - 4);
      CTX.lineTo(LANDER_WIDTH / 2, LANDER_HEIGHT / 4 - 4);
      CTX.closePath();
      CTX.fill();
    },
    useTerrain
  );

  const chunk1 = makeParticle(
    state,
    pieceStart(LANDER_HEIGHT / 2),
    jitterCoordinate(velocity),
    LANDER_WIDTH,
    LANDER_HEIGHT / 2,
    gradient,
    (CTX, position, _, rotationAngle, fill) => {
      CTX.translate(position.x, position.y);
      CTX.rotate(angle);
      CTX.fillStyle = fill;
      CTX.rotate(rotationAngle);
      CTX.beginPath();
      CTX.moveTo(-LANDER_WIDTH / 2, -LANDER_HEIGHT / 4);
      CTX.lineTo(LANDER_WIDTH / 2, -LANDER_HEIGHT / 4);
      CTX.lineTo(LANDER_WIDTH / 2, LANDER_HEIGHT / 4);
      CTX.lineTo(-LANDER_WIDTH / 2, LANDER_HEIGHT / 4);
      CTX.closePath();
      CTX.fill();
    },
    useTerrain
  );

  const chunk2 = makeParticle(
    state,
    pieceStart(0),
    jitterCoordinate(velocity),
    LANDER_WIDTH,
    LANDER_HEIGHT / 2,
    gradient,
    (CTX, position, _, rotationAngle, fill) => {
      CTX.translate(position.x, position.y);
      CTX.rotate(angle);
      CTX.fillStyle = fill;
      CTX.rotate(rotationAngle);
      CTX.beginPath();
      CTX.lineTo(-LANDER_WIDTH / 2, -LANDER_HEIGHT / 4);
      CTX.lineTo(LANDER_WIDTH / 2, -LANDER_HEIGHT / 4);
      CTX.lineTo(LANDER_WIDTH / 2, LANDER_HEIGHT / 4);
      CTX.lineTo(-LANDER_WIDTH / 2, LANDER_HEIGHT / 4);
      CTX.closePath();
      CTX.fill();
    },
    useTerrain
  );

  const randomPieces = makeExplosion(
    state,
    position,
    velocity,
    gradient,
    randomBetween(2, 8),
    32,
    useTerrain
  );

  const draw = (deltaTime) => {
    noseCone.draw(deltaTime);
    chunk1.draw(deltaTime);
    chunk2.draw(deltaTime);
    randomPieces.draw(deltaTime);
  };

  return { draw };
};
