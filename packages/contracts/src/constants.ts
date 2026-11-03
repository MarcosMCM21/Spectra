/**
 * Constantes compartilhadas do monorepo (folha do grafo de dependências).
 *
 * Este módulo não importa nenhum outro arquivo de `@spectra/contracts`, o que
 * permite que `common.ts` e cia. consumam estes valores sem criar ciclo de
 * importação com `index.ts`.
 */

/** Prefixo obrigatório de todo pacote enviado em LiveKit Data Channels. */
export const DATA_CHANNEL_PREFIX = "addon:" as const;

/** Grace period (segundos) antes de hibernar uma sala LiveKit vazia. */
export const ROOM_GRACE_PERIOD_SECONDS = 300;

/**
 * TTL padrão (segundos) concedido a um código temporário de acesso à sala.
 * DEC-17: códigos de acesso são temporários e rotacionáveis.
 */
export const ACCESS_CODE_DEFAULT_TTL_SECONDS = 3600;

/** Limites de expiração aceitos na rotação manual de código de acesso. */
export const ACCESS_CODE_MIN_TTL_SECONDS = 60;
export const ACCESS_CODE_MAX_TTL_SECONDS = 86_400;

/** TTL padrão (segundos) do JWT LiveKit emitido pelo Hub ao entrar numa sala. */
export const ROOM_TOKEN_DEFAULT_TTL_SECONDS = 3600;
