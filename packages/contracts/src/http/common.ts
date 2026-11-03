/**
 * DTOs HTTP compartilhados por todas as rotas do Hub.
 */
import { z } from "zod";

/** Reconhecimento genérico de operação bem-sucedida (`POST .../heartbeat`, etc.). */
export const AckResponseSchema = z.object({ ok: z.literal(true) });
export type AckResponse = z.infer<typeof AckResponseSchema>;
