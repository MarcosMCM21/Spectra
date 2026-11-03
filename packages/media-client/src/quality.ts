/**
 * Tradução dos pedidos de camada de qualidade do Showroom para os filtros de
 * assinatura do LiveKit (AdaptiveStream / `setQuality`).
 *
 * Mapeamento confirmado em `RemoteVideoTrack`:
 * - `original`  -> spatialLayer máximo + temporalLayer máximo;
 * - `1080p`     -> spatialLayer 1;
 * - `720p`      -> spatialLayer 0;
 * - `360p`      -> spatialLayer 0 + temporalLayer 0 (tira de miniaturas);
 * - `auto`      -> deixa o AdaptiveStream decidir (sem filtro).
 */
import type { QualityLayer, TrackFilterOptions } from "./types.js";

export function filterForQualityLayer(quality: QualityLayer): TrackFilterOptions | undefined {
  switch (quality) {
    case "auto":
      return undefined;
    case "original":
      return { spatialLayer: Number.MAX_SAFE_INTEGER, temporalLayer: Number.MAX_SAFE_INTEGER };
    case "1080p":
      return { spatialLayer: 1 };
    case "720p":
      return { spatialLayer: 0 };
    case "360p":
      return { spatialLayer: 0, temporalLayer: 0 };
  }
}

/** Bitrate alvo (bps) por resolução pedida no modal de captura. */
export const SCREEN_BITRATE_BY_HEIGHT: Readonly<Record<number, number>> = {
  720: 6_000_000,
  1080: 15_000_000,
  1440: 30_000_000,
  2160: 50_000_000,
};

export function screenBitrateFor(height: number): number {
  if (SCREEN_BITRATE_BY_HEIGHT[height] !== undefined) return SCREEN_BITRATE_BY_HEIGHT[height] ?? 15_000_000;
  if (height >= 2160) return 50_000_000;
  if (height >= 1440) return 30_000_000;
  if (height >= 1080) return 15_000_000;
  return 6_000_000;
}
