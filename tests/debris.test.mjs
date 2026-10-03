// Debris (lander and asteroid explosions) was coming to rest inside the
// terrain, mostly around peak corners. These run the real particle code
// against a hand-built terrain with a plateau corner and a sharp peak, using
// a canvas stub that answers isPointInPath from the same terrain polyline.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeParticle } from "../particle.js";
import { makeExplosion, makeLanderExplosion } from "../lander/explosion.js";
import { INTERVAL, LANDER_HEIGHT } from "../helpers/constants.js";
import { getPolylineContact } from "../helpers/helpers.js";

const CANVAS_WIDTH = 1200;
const SEGMENT = 60;
const FRAMES = 2000;
// Collision is sampled on a circle smaller than the drawn shape, so allow a
// little overlap; anything deeper is debris sunk into the ground
const TOLERANCE = 2;

// Park–Miller, so every run is reproducible from its seed
const makeRandom = (seed) => {
  let state = seed % 2147483647 || 1;
  return () => (state = (state * 16807) % 2147483647) / 2147483647;
};

const withSeededMathRandom = (seed, run) => {
  const original = Math.random;
  Math.random = makeRandom(seed);
  try {
    return run();
  } finally {
    Math.random = original;
  }
};

// Flat ground at y=600 with a plateau at y=300 from x=240 to x=480 (steep
// drop on both sides) and a single-vertex peak at (840, 300)
const PLATEAU_CORNER = { x: 480, y: 300 };
const PEAK = { x: 840, y: 300 };
const terrainPoints = Array.from(
  { length: CANVAS_WIDTH / SEGMENT + 1 },
  (_, index) => {
    const x = index * SEGMENT;
    const raised =
      (x >= 240 && x <= PLATEAU_CORNER.x) || x === PEAK.x;
    return { x, y: raised ? 300 : 600 };
  }
);

const segmentAt = (x) =>
  Math.max(0, Math.min(Math.floor(x / SEGMENT), terrainPoints.length - 2));

const groundHeightAtX = (x) => {
  const start = terrainPoints[segmentAt(x)];
  const end = terrainPoints[segmentAt(x) + 1];
  return start.y + (end.y - start.y) * ((x - start.x) / SEGMENT);
};

const depthBelowGround = ({ x, y }) => y - groundHeightAtX(x);

// Mirrors the interface terrain.js hands to particles
const terrain = {
  getLandingData: () => ({
    terrainPath2D: "terrain",
    terrainHeight: Math.min(...terrainPoints.map(({ y }) => y)),
  }),
  getSurfaceContact: (point) => getPolylineContact(terrainPoints, point),
  getGroundHeightAtX: groundHeightAtX,
};

// A 2D context that tracks the current transform, so the shapes particles
// fill can be read back in canvas coordinates
const makeContext = () => {
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let path = [];
  const shapes = [];
  const apply = (x, y) => ({
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  });

  return {
    shapes,
    isPointInPath: (_, x, y) =>
      x >= 0 && x <= CANVAS_WIDTH && y > groundHeightAtX(x),
    save: () => stack.push([...matrix]),
    restore: () => (matrix = stack.pop()),
    translate: (x, y) => {
      const { x: e, y: f } = apply(x, y);
      matrix = [matrix[0], matrix[1], matrix[2], matrix[3], e, f];
    },
    rotate: (angle) => {
      const [a, b, c, d, e, f] = matrix;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      matrix = [a * cos + c * sin, b * cos + d * sin, c * cos - a * sin, d * cos - b * sin, e, f];
    },
    beginPath: () => (path = []),
    moveTo: (x, y) => path.push(apply(x, y)),
    lineTo: (x, y) => path.push(apply(x, y)),
    closePath: () => {},
    fill: () => shapes.push(path),
    fillRect: (x, y, width, height) =>
      shapes.push([
        apply(x, y),
        apply(x + width, y),
        apply(x + width, y + height),
        apply(x, y + height),
      ]),
  };
};

const makeState = (CTX) => {
  const values = {
    CTX,
    scaleFactor: 1,
    terrain,
    canvasWidth: CANVAS_WIDTH,
    theme: { landerGradient: "#fff" },
  };
  return { get: (key) => values[key] };
};

const describeBuried = (buried, total) =>
  `${buried.length}/${total} pieces came to rest inside the terrain, ` +
  `deepest ${Math.round(Math.max(...buried.map(({ depth }) => depth)))}px: ` +
  JSON.stringify(buried.slice(0, 3));

const dropDebrisOnto = ({ x: targetX, y: targetY }, seed) =>
  withSeededMathRandom(seed, () => {
    const state = makeState(makeContext());
    const buried = [];
    const total = 200;

    for (let piece = 0; piece < total; piece++) {
      const start = {
        x: targetX + (Math.random() - 0.5) * SEGMENT,
        y: targetY - 50,
      };
      const particle = makeParticle(
        state,
        start,
        { x: (Math.random() - 0.5) * 6, y: Math.random() * 3 },
        2 + Math.random() * 18,
        2 + Math.random() * 18,
        "#fff"
      );

      for (let frame = 0; frame < FRAMES; frame++) particle.draw(INTERVAL);

      const position = particle.getPosition();
      const depth = depthBelowGround(position);
      if (depth > TOLERANCE) buried.push({ start, ...position, depth });
    }

    return { buried, total };
  });

test("debris landing on a plateau corner stays on the surface", () => {
  const { buried, total } = dropDebrisOnto(PLATEAU_CORNER, 7);
  assert.equal(buried.length, 0, describeBuried(buried, total));
});

test("debris landing on a sharp peak stays on the surface", () => {
  const { buried, total } = dropDebrisOnto(PEAK, 11);
  assert.equal(buried.length, 0, describeBuried(buried, total));
});

test("asteroid debris exploding over a peak stays on the surface", () => {
  // asteroids.js onImpact: a chunk per unit of asteroid size, slowed down
  const buried = [];
  let total = 0;

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    withSeededMathRandom(seed, () => {
      const CTX = makeContext();
      const size = 12 + Math.random() * 18;
      const velocity = {
        x: (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 6) * 0.8,
        y: (1 + Math.random() * 3) * 0.2,
      };
      const explosion = makeExplosion(
        makeState(CTX),
        { x: PEAK.x + (Math.random() - 0.5) * SEGMENT, y: PEAK.y - 20 },
        velocity,
        "#fff",
        3 + Math.random() * 12,
        Math.floor(size)
      );

      for (let frame = 0; frame < FRAMES; frame++) {
        CTX.shapes.length = 0;
        explosion.draw(INTERVAL);
      }

      CTX.shapes.forEach((shape) => {
        const centre = {
          x: shape.reduce((sum, { x }) => sum + x, 0) / shape.length,
          y: shape.reduce((sum, { y }) => sum + y, 0) / shape.length,
        };
        const depth = depthBelowGround(centre);
        total++;
        if (depth > TOLERANCE) buried.push({ seed, ...centre, depth });
      });
    });
  }

  assert.equal(buried.length, 0, describeBuried(buried, total));
});

for (const [label, position, angleDeg] of [
  // Resting upright on flat ground
  ["on flat ground", { x: 900, y: 600 - LANDER_HEIGHT / 2 - 1 }, 0],
  // Tipped over the plateau corner, as in the reported screenshot
  ["tilted over a plateau corner", { x: 488, y: 330 }, -47],
]) {
  test(`lander wreckage is drawn outside the terrain when crashing ${label}`, () => {
    withSeededMathRandom(3, () => {
      const CTX = makeContext();
      const explosion = makeLanderExplosion(
        makeState(CTX),
        position,
        { x: -0.5, y: 0.5 },
        (angleDeg * Math.PI) / 180
      );

      for (let frame = 0; frame < FRAMES; frame++) {
        CTX.shapes.length = 0;
        explosion.draw(INTERVAL);
      }

      // The first three shapes are the nose cone and the two body chunks
      const buried = CTX.shapes
        .slice(0, 3)
        .map((shape, index) => {
          const centre = {
            x: shape.reduce((sum, { x }) => sum + x, 0) / shape.length,
            y: shape.reduce((sum, { y }) => sum + y, 0) / shape.length,
          };
          return {
            piece: ["nose cone", "lower chunk", "upper chunk"][index],
            ...centre,
            depth: depthBelowGround(centre),
          };
        })
        .filter(({ depth }) => depth > TOLERANCE);

      assert.equal(buried.length, 0, describeBuried(buried, 3));
    });
  });
}
