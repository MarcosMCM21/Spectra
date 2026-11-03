/**
 * @spectra/media-client — wrapper LiveKit/WebRTC do produto.
 *
 * Centraliza toda a interação com o SFU para que `packages/shared-ui` nunca
 * importe `livekit-client` diretamente, preservando a regra de ouro de
 * desacoplamento. A camada expõe qualidade, simulcast e estados do showroom sem
 * acoplar a UI ao runtime de mídia.
 */
import { PACKAGES, type SpectraPackage } from "@spectra/contracts";

export const MEDIA_CLIENT_PACKAGE: SpectraPackage = "media-client";

/** Camadas de qualidade que o showroom requisitará ao SFU (nunca microfone). */
export const QUALITY_LAYERS = ["auto", "original", "1080p", "720p", "360p"] as const;

export type QualityLayer = (typeof QUALITY_LAYERS)[number];

export * from "./media-client.js";
export * from "./codec.js";

/** Lista base de pacotes internos, reexportada a partir dos contratos. */
export const KNOWN_PACKAGES: readonly SpectraPackage[] = PACKAGES;
