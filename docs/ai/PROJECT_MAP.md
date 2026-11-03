# Mapa do Projeto (`PROJECT_MAP.md`)

> **Instrução para o Agente:** Consulte este mapa antes de usar `list_files` ou `search_files`. Atualize-o sempre que criar novos pacotes ou módulos principais.

## 1. Visão Geral da Árvore do Repositório

```text
├── AGENTS.md                        # Regras globais Layer 0 (sempre carregado)
├── .clinerules/                     # Regras, workflows e hooks de customização do agente
│   ├── 00-Core.md, Backend.md, Frontend.md, Addons.md, Testing.md
│   ├── workflows/                   # Fluxos padronizados (/plan-task, /implement-feature, /verify-and-test, /complete-task)
│   └── hooks/                       # Scripts de guarda de contexto e validação pós-edição
├── .cline/
│   ├── scripts/                     # Validadores e sincronização do workspace de regras
│   └── skills/                      # Procedimentos reutilizáveis (repo-mapping, feature-implementation, debugging, code-review)
├── docs/
│   └── ai/                          # Memória técnica em camadas da IA
│       ├── ACTIVE_CONTEXT.md        # Estado atual e foco imediato (leitura primária)
│       ├── PROJECT_MAP.md           # Este mapa estrutural do repositório
│       ├── ARCHITECTURE.md          # Arquitetura técnica consolidada v2.0
│       ├── DECISIONS.md             # Registro de decisões confirmadas vs. suposições
│       └── PROGRESS.md              # Checklist de execução do Roadmap (Fases 0 a 5)
├── scripts/
│   ├── validate-architecture.mjs    # Wrapper fino -> delega a .cline/scripts/validate-architecture.mjs
│   └── sync-cline-workspace.mjs     # Wrapper fino -> delega a .cline/scripts/sync-cline-workspace.mjs
├── apps/
│   ├── hub/                         # Backend Node.js + Fastify + SQLite (contas, Salas Fixas, permissões e JWT LiveKit)
│   ├── web/                         # SPA React + Vite; src/main.tsx integra Lobby, Hub e Showroom, src/styles.css define a UI
│   └── desktop/                     # Shell Electron, preload IPC e empacotamento Windows NSIS/ZIP com UI Web local
├── packages/
│   ├── contracts/                   # Schemas Zod compartilhados (API HTTP, WS, Data Channels, Manifestos de Addons)
│   ├── media-client/                # Wrapper LiveKit; src/session.ts conecta salas e gerencia tracks/compartilhamento de tela
│   ├── shared-ui/                   # Componentes React desacoplados, RoomLobby e abstrações PlatformBridge
│   └── addon-sdk/                   # SDK TypeScript para criação de Addons e Bots participantes
├── addons/                          # (Fase 1: apenas README.md + .gitkeep; nenhum addon implementado ainda)
│   ├── music-bot/                   # Bot-Participante (Spotify/YT Music) publicando Opus 320kbps + UI Sidebar
│   ├── youtube-stage/               # Addon YouTube Watch Together integrado como card no Grid do Showroom
│   ├── soundpad/                    # Bot de efeitos sonoros compartilhados
│   ├── sim-telemetry/               # Agente local (C#/Python) + Overlay HUD para ETS2, BeamNG, Forza, Assetto Corsa
│   ├── rpg-companion/               # Addon de sessão de RPG/VTT (toasts de dados, presets de clima/luz/áudio)
│   └── replay-buffer/               # Gravação instantânea dos últimos 60s da stream (Alt+F10)
└── deploy/
    ├── docker-compose.yml           # Orquestração Caddy + LiveKit + Hub + Addons (via Profiles)
    ├── livekit.yaml                 # Configuração SFU, portas UDP (7882 Mux / 50000-50200) e TURN embutido
    └── Caddyfile                    # Proxy reverso HTTPS/TLS automático e WebSockets
```

## 2. Fronteiras de Dependência entre Pacotes
- `packages/contracts` -> **Zero dependências internas** (base para todos os outros pacotes).
- `packages/media-client` -> depende de `packages/contracts` e `livekit-client`.
- `packages/shared-ui` -> depende de `packages/contracts` e `PlatformBridge`. **Proibido** depender de `electron` ou `livekit-client`.
- `packages/addon-sdk` -> depende apenas de `packages/contracts`.
- `apps/web` -> usa `packages/shared-ui` para o lobby e `packages/media-client` para a sessão LiveKit.
- `apps/desktop` -> carrega a aplicação web por URL configurável; `src/preload.cts` expõe enumeração/seleção de tela por `contextBridge`, sem expor APIs Node ao renderer.
- `apps/hub` -> depende de `packages/contracts`, `fastify`, `better-sqlite3`/`drizzle-orm` e `livekit-server-sdk`.

## 3. Estado de Implementação (Fase 1)
O lobby web consulta o Hub e oferece autenticação por apelido/senha, criação/entrada de salas, perfil e favoritos por conta. No desenvolvimento, o Hub observa somente `apps/hub/src` e a Web aguarda `/healthz` antes de iniciar o Vite e encaminhar chamadas `/api`. O Showroom conecta ao LiveKit com grade/foco, tela cheia, OSD (volume/mudo por participante e master), seleção de camadas, Smart Zoom e HUD de estatísticas RTP. Captura limita resolução/FPS aos valores escolhidos, mantém o bitrate total limitado entre encoders e oferece H.264 Simulcast ou VP9/AV1 SVC (`L1T3` em screen share) com checagem de suporte e fallback. A conexão inicial usa tentativas limitadas e reconexão da sessão fica com o SDK LiveKit. Desktop empacota a UI compilada localmente para Windows (NSIS/ZIP), enumera/seleciona fontes por preload IPC e permite configurar o Hub por `SPECTRA_HUB_URL`; áudio isolado por aplicativo permanece pendente. PiP e Addons continuam pendentes. Identidades LiveKit são exclusivas por conexão para permitir sessões Web e Desktop simultâneas. O grafo de dependências permanece gerenciado por Turborepo (`dependsOn: ["^build"]`).
