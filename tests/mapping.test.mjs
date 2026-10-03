import { test } from "node:test";
import assert from "node:assert/strict";
import {
  forceToThrottle,
  hoverThrottle,
  hoverForce,
  isHoverBelowThreshold,
  makeThresholdGate,
} from "../forcesensor/mapping.js";

const linear = { fmax: 20, hover: 30, curve: "linear", threshold: 1 };
const exponential = { ...linear, curve: "exponential" };

test("throttle is (force − threshold) / (Fmax − threshold)", () => {
  assert.equal(forceToThrottle(1, linear), 0);
  assert.equal(forceToThrottle(20, linear), 1);
  assert.equal(forceToThrottle(10.5, linear), 0.5);
});

test("throttle is clamped to 0…1", () => {
  assert.equal(forceToThrottle(-3, linear), 0);
  assert.equal(forceToThrottle(0.5, linear), 0);
  assert.equal(forceToThrottle(80, linear), 1);
});

test("exponential curve keeps the ends and is finer at low forces", () => {
  assert.equal(forceToThrottle(1, exponential), 0);
  assert.ok(Math.abs(forceToThrottle(20, exponential) - 1) < 1e-12);
  for (const force of [3, 6, 10, 15]) {
    assert.ok(forceToThrottle(force, exponential) < forceToThrottle(force, linear));
  }
});

test("hover point is a share of Fmax mapped through the curve", () => {
  assert.equal(hoverForce(linear), 6);
  assert.equal(hoverThrottle(linear), (6 - 1) / 19);
  assert.equal(hoverThrottle(exponential), forceToThrottle(6, exponential));
});

test("a hover point under the threshold never asks for infinite thrust", () => {
  const broken = { ...linear, fmax: 3, hover: 20 };
  assert.ok(isHoverBelowThreshold(broken));
  assert.ok(hoverThrottle(broken) > 0);
});

test("threshold gate turns on above 1.0 kg and off below 0.7 kg", () => {
  const gate = makeThresholdGate();
  const sequence = [0.5, 0.95, 1.05, 0.9, 0.75, 0.69, 0.9, 1.01];
  const expected = [false, false, true, true, true, false, false, true];
  assert.deepEqual(
    sequence.map((force) => gate.update(force, 1)),
    expected
  );
});
