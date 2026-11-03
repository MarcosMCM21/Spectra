/**
 * @spectra/shared-ui — bloco de UI compartilhada da Fase 1.
 *
 * REGRAS ARQUITETURAIS DESTE PACOTE (Hard Constraints):
 *   1. NUNCA importar `electron` nem `livekit-client` (Regra de Ouro).
 *   2. Todo acesso a recursos de sistema/Plataforma passa pela interface
 *      `PlatformBridge` injetada pelos apps (`apps/web`, `apps/desktop`).
 *   3. Nenhum controle, indicador ou configuração de microfone/voz é permitido.
 */
import { PACKAGES, type SpectraPackage } from "@spectra/contracts";

export const SHARED_UI_PACKAGE: SpectraPackage = "shared-ui";

/** Lista base de pacotes internos, reexportada a partir dos contratos. */
export const KNOWN_PACKAGES: readonly SpectraPackage[] = PACKAGES;

export * from "./platform.js";
export * from "./components.js";
