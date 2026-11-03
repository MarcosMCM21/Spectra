/**
 * @spectra/contracts — contrato base do produto e das APIs do monorepo.
 *
 * Este pacote define os schemas Zod definitivos para salas fixas, autenticação
 * por conta, permissões de moderação, payloads de
 * Addons e os contratos HTTP/WS usados pelos apps e pelo Hub.
 *
 * Regra arquitetural: este pacote é a BASE do grafo e NÃO pode depender de
 * nenhum outro pacote interno do monorepo.
 */

/** Identificadores dos pacotes internos do monorepo (ordem topológica). */
export const PACKAGES = [
  "contracts",
  "media-client",
  "shared-ui",
  "addon-sdk",
  "hub",
  "web",
  "desktop",
] as const;

export type SpectraPackage = (typeof PACKAGES)[number];

export * from "./constants.js";
export * from "./common.js";
export * from "./rooms.js";
export * from "./auth.js";
export * from "./moderation.js";
export * from "./http/common.js";
export * from "./http/rooms.js";
export * from "./validation.js";
