/**
 * @spectra/addon-sdk — base do ecossistema de addons da plataforma.
 *
 * O SDK fornece a infraestrutura para `manifest.json`, canais de dados
 * (`addon:<id>`), integração com a UI e bots participantes do produto,
 * preservando o modelo de comunicação validado por Zod.
 */
import { DATA_CHANNEL_PREFIX } from "@spectra/contracts";

/** Slots de UI onde um addon pode ser montado em `<iframe sandbox="allow-scripts">`. */
export const ADDON_SLOTS = ["sidebar", "stage-grid", "toolbar", "overlay"] as const;

export type AddonSlot = (typeof ADDON_SLOTS)[number];

/** Constrói o nome de Data Channel com o prefixo obrigatório `addon:<id>`. */
export function addonChannelName(addonId: string): string {
  return `${DATA_CHANNEL_PREFIX}${addonId}`;
}
