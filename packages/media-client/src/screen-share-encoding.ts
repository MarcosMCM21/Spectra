export interface ScreenResolution {
  width: number;
  height: number;
}

export interface ScreenCaptureConstraints {
  width: { ideal: number; max: number };
  height: { ideal: number; max: number };
  frameRate: { ideal: number; max: number };
}

export function createScreenCaptureConstraints(
  resolution: ScreenResolution,
  maxFramerate: number,
): ScreenCaptureConstraints {
  return {
    width: { ideal: resolution.width, max: resolution.width },
    height: { ideal: resolution.height, max: resolution.height },
    frameRate: { ideal: maxFramerate, max: maxFramerate },
  };
}

export function allocateScreenShareBitrate(
  totalBitrate: number,
  scaleResolutionDownBy: readonly number[],
): number[] {
  if (!Number.isSafeInteger(totalBitrate) || totalBitrate <= 0) {
    throw new RangeError("The total screen-share bitrate must be a positive integer.");
  }
  if (scaleResolutionDownBy.length === 0) {
    throw new RangeError("At least one screen-share encoding is required.");
  }

  const weights = scaleResolutionDownBy.map((scale) => {
    if (!Number.isFinite(scale) || scale < 1) {
      throw new RangeError("Screen-share encoding scales must be finite and at least 1.");
    }
    return 1 / (scale * scale);
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let allocated = 0;

  return weights.map((weight, index) => {
    const bitrate = index === weights.length - 1
      ? totalBitrate - allocated
      : Math.floor(totalBitrate * weight / totalWeight);
    allocated += bitrate;
    return bitrate;
  });
}
