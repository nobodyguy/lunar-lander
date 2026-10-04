import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRangeResponse } from "../helpers/rangeresponse.js";

const bytes = Uint8Array.from({ length: 10 }, (_, i) => i);
const full = () =>
  new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } });
const body = async (response) =>
  Array.from(new Uint8Array(await response.arrayBuffer()));

test("bytes=a-b returns that slice as a 206", async () => {
  const response = await makeRangeResponse("bytes=2-4", full());
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 2-4/10");
  assert.equal(response.headers.get("Content-Length"), "3");
  assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
  assert.deepEqual(await body(response), [2, 3, 4]);
});

test("open-ended ranges run to the end of the file", async () => {
  const response = await makeRangeResponse("bytes=0-", full());
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 0-9/10");
  assert.deepEqual(await body(response), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("an end past the file is clamped to its last byte", async () => {
  const response = await makeRangeResponse("bytes=8-100", full());
  assert.equal(response.headers.get("Content-Range"), "bytes 8-9/10");
  assert.deepEqual(await body(response), [8, 9]);
});

test("suffix ranges return the last n bytes", async () => {
  const response = await makeRangeResponse("bytes=-3", full());
  assert.equal(response.headers.get("Content-Range"), "bytes 7-9/10");
  assert.deepEqual(await body(response), [7, 8, 9]);
});

test("a range starting past the file is unsatisfiable", async () => {
  const response = await makeRangeResponse("bytes=10-", full());
  assert.equal(response.status, 416);
  assert.equal(response.headers.get("Content-Range"), "bytes */10");
});

test("multi-range and malformed headers get the whole file", async () => {
  for (const header of ["bytes=0-1,4-5", "items=0-1", "bytes=-"]) {
    const response = await makeRangeResponse(header, full());
    assert.equal(response.status, 200);
    assert.equal((await body(response)).length, 10);
  }
});
