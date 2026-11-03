# AGENTS.md — Diretrizes Globais do Agente (Layer 0)

## 1. Identidade do Projeto
Plataforma privada e *self-hosted* de **compartilhamento de tela em ultra-alta definição (até 4K60, 50 Mbps)** e consumo de mídia sincronizada (Addons) para grupos de 5 a 20 usuários, operando em conjunto com o Discord.
- **Monorepo:** TypeScript gerenciado via `pnpm` e `Turborepo`.
- **Mídia:** LiveKit SFU (Self-Hosted) com Simulcast/SVC (`H.264`, `AV1`, `VP9`), `adaptiveStream` e `dynacast`.
- **Apps:** `apps/hub` (Fastify + SQLite), `apps/web` (React + Vite + Tailwind + Zustand) e `apps/desktop` (Electron).
- **Pacotes:** `packages/contracts` (Zod), `packages/media-client` (LiveKit wrapper), `packages/shared-ui` (UI desacoplada), `packages/addon-sdk`.

## 2. Regras Inegociáveis (Hard Constraints)
1. **ZERO VOZ / MICROFONE:** A comunicação de voz ocorre no Discord. Nunca implemente captura de microfone, VoIP, Mute/Deafen de microfone ou detecção de fala. O áudio restringe-se ao **loopback do sistema/jogo** e aos **Addons de mídia**.
2. **REGRA DE OURO DE DESACOPLAMENTO:** Componentes em `packages/shared-ui` **JAMAIS** importam `electron` ou `livekit-client` diretamente. Todo acesso deve ocorrer via hooks de `packages/media-client` ou via interface `PlatformBridge`.
3. **CONTRATOS PRIMEIRO (ZOD):** Toda rota HTTP, evento WebSocket, payload de Data Channel (`addon:<id>`) e `manifest.json` deve ser validado em `packages/contracts` com `Zod`.
4. **SALAS FIXAS E CHAVE DE CRIADOR:** Salas são persistentes no SQLite (`slug` fixo), mas efêmeras sob demanda no LiveKit (com *grace period* de 5 min quando vazias). A posse (`admin`) é validada via **Chave de Criador Persistente** (`secret_token_hash`).

## 3. Protocolo de Contexto em Camadas (Otimização para LLM Local)
Para economizar janela de contexto e evitar leituras redundantes:
1. **Início de Tarefa:** Leia **apenas** `docs/ai/ACTIVE_CONTEXT.md`.
2. **Navegação:** Consulte `docs/ai/PROJECT_MAP.md` antes de executar buscas globais de arquivos. Nunca leia `node_modules/`, `dist/`, `.turbo/` ou `data/`.
3. **Consulta Sob Demanda:**
   - Dúvidas de arquitetura/fluxo de mídia -> `docs/ai/ARCHITECTURE.md`
   - Dúvidas sobre escopo/regras confirmadas vs. suposições -> `docs/ai/DECISIONS.md`
   - Status de fases e entregas -> `docs/ai/PROGRESS.md`
4. **Conclusão de Tarefa (Auto-Atualização Obrigatória):** Ao concluir qualquer implementação ou decisão técnica relevante, execute o workflow `/complete-task` para atualizar `docs/ai/ACTIVE_CONTEXT.md` e `docs/ai/PROGRESS.md`.
