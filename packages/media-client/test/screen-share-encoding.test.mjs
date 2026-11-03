import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateScreenShareBitrate,
  createScreenCaptureConstraints,
} from "../dist/screen-share-encoding.js";

test("screen capture constraints cap both resolution and frame rate", () => {
  assert.deepEqual(
    createScreenCaptureConstraints({ width: 2560, height: 1440 }, 60),
    {
      width: { ideal: 2560, max: 2560 },
      height: { ideal: 1440, max: 1440 },
      frameRate: { ideal: 60, max: 60 },
    },
  );
});

test("simulcast layers share one total bitrate budget by resolution", () => {
  const allocation = allocateScreenShareBitrate(12_000_000, [2, 1]);

  assert.deepEqual(allocation, [2_400_000, 9_600_000]);
  assert.equal(allocation.reduce((sum, bitrate) => sum + bitrate, 0), 12_000_000);
});

test("bitrate allocation rejects invalid limits and empty encodings", () => {
  assert.throws(() => allocateScreenShareBitrate(0, [1]), RangeError);
  assert.throws(() => allocateScreenShareBitrate(1_000, []), RangeError);
  assert.throws(() => allocateScreenShareBitrate(1_000, [0]), RangeError);
});
