import assert from "node:assert/strict";
import test from "node:test";
import { publishWithH264Fallback } from "../dist/codec.js";

test("publishes the selected codec without fallback when supported", async () => {
  const attempts = [];
  const result = await publishWithH264Fallback("vp9", async (codec) => {
    attempts.push(codec);
  }, async () => {
    assert.fail("cleanup should not run");
  });

  assert.deepEqual(attempts, ["vp9"]);
  assert.deepEqual(result, { codec: "vp9", fellBackToH264: false });
});

test("retries an unsupported efficient codec with H.264", async () => {
  const attempts = [];
  let cleanedUp = false;
  const result = await publishWithH264Fallback("av1", async (codec) => {
    attempts.push(codec);
    if (codec === "av1") throw new Error("AV1 encoder unavailable");
  }, async () => {
    cleanedUp = true;
  });

  assert.deepEqual(attempts, ["av1", "h264"]);
  assert.equal(cleanedUp, true);
  assert.deepEqual(result, { codec: "h264", fellBackToH264: true });
});

test("does not retry H.264 errors or suppress the failure", async () => {
  const error = new Error("H.264 publish failed");
  const attempts = [];

  await assert.rejects(
    publishWithH264Fallback("h264", async (codec) => {
      attempts.push(codec);
      throw error;
    }, async () => {
      assert.fail("cleanup should not run");
    }),
    error,
  );
  assert.deepEqual(attempts, ["h264"]);
});
