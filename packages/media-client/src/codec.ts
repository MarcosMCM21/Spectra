import type { ScreenShareCodec } from "./session.js";

export interface CodecPublishResult {
  codec: ScreenShareCodec;
  fellBackToH264: boolean;
}

export async function publishWithH264Fallback(
  codec: ScreenShareCodec,
  publish: (codec: ScreenShareCodec) => Promise<void>,
  cleanupPartialPublish: () => Promise<void>,
): Promise<CodecPublishResult> {
  try {
    await publish(codec);
    return { codec, fellBackToH264: false };
  } catch (error) {
    if (codec === "h264") throw error;
    await cleanupPartialPublish();
    await publish("h264");
    return { codec: "h264", fellBackToH264: true };
  }
}
