# Progresso de Execução e Roadmap (`PROGRESS.md`)

> **Instrução para o Agente:** Atualize os checkboxes abaixo sempre que concluir uma entrega validada via `/complete-task`.

## Pré-Fase: Planejamento e Engenharia de Contexto IA
- [x] Consolidação do Documento Mestre de Planejamento, Arquitetura e UX/UI (v2.0).
- [x] Definição de Salas Fixas, conta por apelido/senha e Bot de Música Server-Side.
- [x] Configuração do ambiente Cline (`.cline/rules`, `.cline/skills`, `.cline/workflows`, `.cline/hooks`, `docs/ai/*`, `AGENTS.md`).
- [x] Revisão do `.gitignore` para cobrir arquivos de ambiente/segredos, chaves privadas, caches, artefatos de build e arquivos locais de IDE; templates `.env.example` permanecem versionáveis.

## Fase 0: Prova de Rede e Engenharia de Mídia (Concluída)
- [x] `deploy/docker-compose.yml`, `deploy/livekit.yaml`, `deploy/Caddyfile` e `deploy/.env.example` configurados; `.env` de produção permanece local, privado e não versionado.
- [x] Deploy Linux/CasaOS documentado em `docs/DEPLOYMENT.md`: testes locais, build, serviço systemd do Hub, Caddy servindo Web estática, LiveKit em host network, segredos, firewall e atualização. Caddy encaminha Hub/LiveKit por loopback; export CasaOS redundante removido. Validação no servidor ainda pendente.
- [x] Corrigidos blockers de clone limpo reportados no log do servidor: `scripts/validate-architecture.mjs` independente dos diretórios `.cline` ignorados, dependência direta `zod` no Hub e allowlist do `electron-winstaller`; pnpm install `--frozen-lockfile`, typecheck e build validados localmente.
- [x] Documentado diagnóstico do Caddy com `/healthz` 200 e `/` 404: confirmar `apps/web/dist/index.html`, bind mount para `/srv/spectra/web`, recriar o Caddy pelo Compose do clone e acessar a Web pelo domínio HTTPS na porta configurada.

## Fase 1: MVP Web com Salas Fixas, Showroom e Moderação (Semanas 1 a 2)
- [x] Setup do Monorepo (`pnpm-workspace.yaml`, `turbo.json`, `packages/contracts`). **Concluído:** grafo de dependências em ordem topológica via `^build` — `contracts` → `media-client` / `shared-ui` / `addon-sdk` → `hub` → `web` / `desktop`; `pnpm install` + `typecheck` (10/10) + `build` (7/7) verdes.
- [x] Atualização de todas as dependências para a última versão estável do registry (`turbo 2.11.10`, `zod 4.6.7`, `livekit-client 2.23.0`, `react`/`react-dom 19.3.1`, `@vitejs/plugin-react 6.1.2`, `vite 8.3.5`/rolldown, `zustand 5.0.16`, `better-sqlite3 13.0.3`, `fastify 5.12.7`, `livekit-server-sdk 2.19.2`, `@types/better-sqlite3 9.6.0`, `@types/node 26.6.6`, `tsx 4.23.15`, `electron 45.1.0`). **Concluído:** `typecheck` (10/10), `build` (7/7), `test` (14/14) e `validate:arch` (0 erros) verdes; binário Electron 45 baixado (`electron.exe` v45.1.0); engine mínima Node elevada para `>=22.12.0`. TypeScript deliberadamente mantido em `^5.9.3` — migração para TS 7 adiada (DEC-13).
- [x] Renomeação global do projeto: `streamhub` → **Spectra** (escopo npm `@spectra/*` nos 7 pacotes + raiz, tipo `SpectraPackage`, labels de UI, serviço do Hub, env e docs). **Concluído:** lockfile regenerado, busca por `streamhub` nas fontes = zero ocorrências, `typecheck` (10/10) / `build` (7/7) / `test` (14/14) / `validate:arch` (0 erros) verdes.
- [x] Correção da falha de `pnpm dev` (`@spectra/desktop#dev` exit 1). **Causa raiz:** `apps/desktop/package.json` declarava `"main": "./dist/main.js"` enquanto a única fonte (`src/index.ts`) é compilada para `dist/index.js`; `electron .` falhava com `MODULE_NOT_FOUND` e o fail-fast do Turbo derrubava os 7 pacotes. **Concluído:** `"main": "./dist/index.js"` (DEC-16); Electron v45 abre a janela do shell sem erro; logs residuais de diagnóstico removidos. Verificação: `build` (7/7), `test` (14/14), `validate:arch` (0 erros) e `pnpm dev` estável com Hub `GET /healthz` → 200 e Vite `:5173` → 200.
- [x] Compilação do Hub validada sem cache: nenhum `tsbuildinfo` presente; `tsc -p apps/hub/tsconfig.json` emite 9 arquivos em `apps/hub/dist` (exit 0), `turbo run test build` = 14/14, `@spectra/web` buildado. **Diagnóstico:** os erros de Zod reportados em sessões anteriores já estão resolvidos; `routes/rooms.ts` não precisa de cast `as T` (usa `request.body as <Type>` + `satisfies ZodRouteSchema`, sem `Schema.parse`). Logs residuais (`o1.txt`, `o2.txt`, `listfiles.txt`, `tsc-out.txt`, `tsc-err.txt`) removidos.
- [x] Contratos DEC-17 em `packages/contracts`: `ApiErrorSchema` com `issues` opcional (`z.array(z.unknown())`) para propagar falhas de validação Zod; helpers `validateWithZod` / `validationFailure` e tipos `ValidationIssue` / `ValidationResult` / `ValidationError` exportados por `src/validation.ts`. **Concluído:** `RoomSlugSchema` mantém `min(3)` (slug mínimo de 3 caracteres) e a suíte foi corrigida para `"abc"` válido / `"ab"` inválido. Verificação: `pnpm --filter @spectra/contracts build`, `typecheck` e `test` = 11/11 verdes.
- [x] **Testes de regressão do Hub:** suíte em `apps/hub` cobre salas fixas, JWT LiveKit sem `microphone`, moderação, respostas de API, autenticação por conta e isolamento/listagem de salas (9/9 verdes).
- [x] `apps/hub`: Fastify (`:3001`) + SQLite com contas por apelido/senha, Salas Fixas com código permanente compartilhável e emissão de JWT LiveKit sem microfone.
- [x] `packages/media-client`: Wrapper LiveKit conecta à sala, publica/encerra compartilhamento de tela e trata tracks, com `adaptiveStream` e `dynacast`. Perfil Fluidez/Nitidez, resolução, FPS e bitrate podem ser reaplicados à captura ativa; transmissões recebidas permitem limitar a camada máxima (adaptativa/média/baixa) e o diagnóstico exibe estado da conexão, participantes, telas e faixas de áudio. Reteste real de camada e métricas ainda pendente.
- [x] `apps/hub`: Contas persistentes por apelido e senha, migração SQLite, rotas de cadastro/login/sessão e visibilidade de salas por dono/membro; testes cobrem credenciais, duplicidade, sessão e isolamento de salas.
- [x] Recuperação de senha: confirmação no cadastro, código de recuperação com cópia/download obrigatório, hash HMAC no banco, recuperação com nova senha confirmada e novo código; código é reemitido no login/sessão até ser confirmado. Verificado em `pnpm test` (Hub 9/9, contratos 13/13; build do workspace concluído).
- [x] Salas: Hub gera código permanente compartilhável, migra as salas existentes sem alterar seus identificadores internos, resolve código para sala e mantém senha obrigatória nas privadas; lobby e links usam o código. Verificado em `pnpm test` (Hub 10/10, contratos 14/14), build do workspace e navegador com API simulada.
- [x] `apps/web` (`:5173`): Lobby conectado ao Hub com busca, favoritos por conta, criação/entrada de salas e perfil; grade automática, foco clicável com coluna lateral rolável, fullscreen independente e opções de bitrate/FPS com aplicação ao vivo. Captura Web solicita áudio apenas da janela quando o navegador oferece suporte; não solicita áudio global.
- [x] Polimento da captura e do Desktop: removido menu superior do Electron; seletores de criação/entrada usam a conta ativa sem pedir apelido de novo; seletor Desktop ampliado, com cartões 16:9, resolução/posição do monitor e descrição específica da janela. Web abre o seletor nativo do navegador com instruções e erros de suporte/permissão explícitos. Controles de resolução/FPS/bitrate Kbps em linhas com recomendação dinâmica.
- [x] Identidades de conexão LiveKit exclusivas por entrada: Web e Desktop podem conectar à mesma sala com a mesma conta sem substituir o participante anterior. A moderação resolve identidades de sessão e consulta conexões da conta para propagar bloqueio, banimento, remoção e encerramento de transmissão. Testes do Hub cobrem identidade nova por conexão e várias sessões moderadas.
- [x] Compartilhamento para convidados autorizados: acesso por link/senha/código passa a habilitar publicação de tela por padrão (como definido no documento mestre); moderação pode revogar a permissão. Teste verifica o JWT sem fontes além de compartilhamento de tela.
- [x] A lista de salas usa identidade autenticada: salas próprias e salas em que a conta entrou; se a presença LiveKit falhar, salas persistidas continuam visíveis com status de presença indisponível.
- [x] Lobby: colagem de links sem duplicação, avisos informativos temporários e exclusão de sala com confirmação/autorização da conta. Resposta informa quando não foi possível confirmar a limpeza da sessão LiveKit.
- [x] Diagnóstico de conexão: log de 03/11 mostra TLS estabelecido e erros 502 por falha DNS do upstream `livekit` no Caddy (não por certificado). Caddy agora usa loopback para Hub/LiveKit e serve a Web compilada; implantação/reteste no servidor pendente.
- [x] Captura no Electron: Desktop enumera telas/janelas via IPC/preload e oferece seleção visual integrada à UI antes de chamar `getDisplayMedia`; a publicação de loopback global foi removida para não confundi-la com áudio isolado da janela. Build aprovado; reteste manual com o aplicativo atualizado pendente.
- [x] Comandos `apps/hub` `dev`/`start` carregam `deploy/.env`; Electron aguarda a UI Web e apresenta ações de recuperação se ela não responder.
- [ ] Implementar captura de áudio isolada por processo/janela no Desktop; Electron atualmente oferece apenas loopback global no handler de captura e essa opção permanece desativada para não transmitir áudio de outros aplicativos.
- [x] Menu de Contexto de Moderação do Admin integrado ao avatar no dock (encerrar stream, bloquear/liberar compartilhamento, kick, ban e transferir host), com confirmação para ações destrutivas e feedback do Hub/LiveKit.
- [x] Desktop distribuível no Windows sem Vite: `pnpm --filter @spectra/desktop package:win` empacota a Web compilada com o Electron e gera instalador NSIS + ZIP portátil. `SPECTRA_HUB_URL` pode configurar o Hub remoto no lançamento; `VITE_HUB_URL` pode fixá-lo no build, e `SPECTRA_WEB_URL` permanece como override. Build do pacote concluído; instalação limpa e captura real ainda aguardam reteste manual.

## Fase 2: OSD Avançado, Smart Zoom, AV1 e Resiliência (Semana 3)
- [x] OSD com volume/mudo local `0%–200%` (`GainNode`), Mixer Geral e seletor individual de camada (`Auto`, `Original`, `1080p`, `720p`); HUD de resolução, FPS, bitrate, codec, RTT, jitter e pacotes perdidos.
- [x] **Smart Zoom / Recorte Livre** interativo, com modos Ajustar/Preencher/Recorte para fontes Ultrawide (`21:9` / `32:9`) e controles ocultos após 2,5 s.
- [x] Toggle de codec H.264 / VP9 SVC / AV1 SVC; consulta capacidades do browser e tenta H.264 automaticamente se o codec eficiente não estiver disponível ou a publicação falhar.
- [x] Conexão inicial repete até 3 tentativas com espera exponencial limitada; reconexão durante a sessão fica sob o comportamento automático do LiveKit, exibindo estados ao vivo. Seletor de camada limita cada espectador sem alterar outros participantes.
- [x] Revisão do core de captura/publicação: resolução e FPS selecionados agora são limites máximos; H.264 mantém duas camadas Simulcast com bitrate agregado limitado ao valor escolhido (inclusive em ajustes ao vivo); AV1/VP9 usam verificação de suporte do LiveKit e screen share SVC correto (`L1T3`).
- [ ] Validar em sala LiveKit real: troca de foco/camada, codec por encoder disponível, retomada após queda e matriz de rede limitada (incluindo 6 Mbps). Os testes automatizados não substituem esta medição.

## Fase 3: Cliente Desktop em Electron, PiP Imersivo e Gamepad UI (Semanas 4 a 5)
- [ ] `apps/desktop`: Shell Electron com `PlatformBridge` via `contextBridge` e flags de Hardware Encode (NVENC/AMF).
- [ ] Seletor visual nativo de Monitores e Janelas (`desktopCapturer`) integrado à UI; áudio isolado por aplicação no Windows (sem loopback global).
- [ ] Janela **PiP Transparente e Click-Through** (*always-on-top*, sem bordas, opacidade ajustável).
- [ ] **Gamepad UI** (navegação por controle no Grid, foco e volume) + Atalhos Globais + System Tray.

## Fase 4: Arquitetura de Addons v1 — Mídia, Telemetria e RPG (Semanas 6 a 7)
- [ ] Barramento de eventos no Hub, validador de `manifest.json` (`Zod`), tokens restritos e slots `<iframe sandbox>`.
- [ ] Addon **Bot de Música (Spotify / YT Music)** publicando Opus 320kbps + Gaveta Lateral (`sidebar`) + Mini-Player no Header.
- [ ] Addon **YouTube Watch Together** integrado como card expansível no Grid do Showroom.
- [ ] Addon **Soundpad** e **Modo Teatro / Sessão de RPG** (toasts de dados e presets de ambiente).
- [ ] Addon **Telemetria de Simuladores Veiculares** (agente C#/Python + HUD overlay via Data Channel).

## Fase 5: Pipeline Nativo de Captura, Replay Buffer e Polimento (Semana 8+ / Sob Demanda)
- [ ] Addon **Replay Buffer / Clipes** (`Alt+F10` salvando os últimos 60 segundos).
- [ ] Rotina automatizada de backup do SQLite e guia de migração rápida de 1 página.
- [ ] *(Condicional)* Sidecar Nativo em C#/.NET ou Rust via *Windows Graphics Capture API*.
