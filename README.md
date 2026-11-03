# Spectra — Plataforma Self-Hosted de Compartilhamento de Tela e Mídia ($4\text{K}60$)

Plataforma privada e *self-hosted* de compartilhamento de tela de ultra-alta definição (até $4\text{K}$ a $60+\text{ FPS}$, $50\text{ Mbps}$) e consumo de mídia sincronizada, desenhada para operar em conjunto com o Discord em grupos fechados de $5$ a $20$ usuários.

---

## 🤖 Guia Rápido para Agentes de IA (Cline / LLM Local)

> **ATENÇÃO IA:** Este repositório utiliza **Contexto em Camadas** para economizar tokens e preservar a janela de contexto do modelo local. **Não leia todos os arquivos de documentação de uma só vez.**

1. **Regras Globais Inegociáveis:** Sempre respeite `AGENTS.md` e `.cline/rules/00-Core.md`.
2. **Ponto de Partida Obrigatório:** Antes de iniciar qualquer tarefa, leia apenas `docs/ai/ACTIVE_CONTEXT.md` para entender o estado atual e o foco imediato.
3. **Carregamento Sob Demanda:**
   * Mapa de pastas e fronteiras de pacotes $\rightarrow$ `docs/ai/PROJECT_MAP.md`
   * Especificação técnica detalhada (SFU, SQLite, Addons) $\rightarrow$ `docs/ai/ARCHITECTURE.md`
   * Decisões confirmadas vs. pontos condicionais $\rightarrow$ `docs/ai/DECISIONS.md`
   * Checklist das Fases $0$ a $5$ $\rightarrow$ `docs/ai/PROGRESS.md`
4. **Workflows Padronizados:** Utilize `/plan-task`, `/implement-feature`, `/verify-and-test` e `/complete-task` (este último atualiza a memória técnica ao concluir entregas).

---

## 1. Visão Geral e Premissas de Escopo

O **Spectra** resolve as limitações artificiais de resolução, taxa de quadros, bitrate e bloqueios de áudio de bots presentes em plataformas convencionais, mantendo uma operação enxuta:

* **Foco Estrito em Vídeo de Tela e Mídia (Zero Microfone):** A comunicação por voz permanece 100% no Discord. O aplicativo **não captura microfone** nem possui controles de VoIP. Todo o pipeline de áudio é dedicado ao **loopback estéreo do sistema/jogo** e aos **Addons multimídia** em alta fidelidade (Opus $48\text{ kHz}$ até $320\text{ kbps}$).
* **Recepção Independente via SFU (LiveKit):** O servidor roteia pacotes RTP em memória sem transcodificação (poupando CPU/GPU do host). Usando **Simulcast**, **Dynacast** e **AdaptiveStream**, cada espectador recebe a camada compatível com sua janela e rede (`Original`, `1080p` ou `720p`) sem derrubar a qualidade dos amigos em conexões superiores.
* **Salas Fixas (Persistentes) sem Fricção:** As salas possuem URL/identificador permanente (`slug`) salvo no SQLite do Hub. A sessão de mídia no LiveKit acorda automaticamente quando o $1^\circ$ membro entra e hiberna após $5\text{ minutos}$ vazia (*grace period*).
* **Identidade Passwordless (`CreatorKey`):** Geração transparente de chave criptográfica local no $1^\circ$ acesso (com exportação/importação de código de recuperação) que garante a posse permanente (`admin`) das salas criadas entre navegador Web e cliente Desktop, sem exigir cadastro de e-mail/senha.

---

## 2. Principais Funcionalidades e UX/UI

### Lobby (Tela Inicial)
* **Cards de Salas Frequentes:** Entrada com $1$ clique exibindo status em tempo real (quantos membros estão assistindo `👁️`, quantos estão transmitindo `🔴` ou se a sala está em hibernação `⚪`).
* **Auto-Paste Inteligente:** Campo único que aceita tanto o `slug` (`jogatina-principal`) quanto a URL completa colada da área de transferência.
* **Gestão de Chave de Criador:** Modal rápido para editar apelido e exportar/importar a `CreatorKey`.

### Sala de Transmissão (Showroom + Dock)
* **Showroom Dinâmico (Modo Grid vs. Modo Foco):**
  * **Modo Grid:** Divide automaticamente a área superior entre todas as transmissões ativas (requisitando camadas leves de $720\text{p}$/$1080\text{p}$ ao SFU).
  * **Modo Foco:** Ao clicar em qualquer stream (ou no avatar de quem transmite), o player se expande para 100% do palco na camada `Original` ($4\text{K}60$ / $1440\text{p}60$), recolhendo as demais transmissões para uma **Tira Flutuante de Miniaturas** ($360\text{p}$) e mantendo os membros visíveis no Dock inferior.
* **Controles do Player (OSD):**
  * Volume individual por stream de $0\%$ a $200\%$ (*boost* via `GainNode` da Web Audio API) + Mixer Geral no Dock.
  * Seletor de camada (`Auto`, `Original`, `1080p60`, `720p60`), Modo Teatro, Tela Cheia e **HUD de Diagnóstico** (*Stats for Nerds*: FPS, Bitrate, Codec, RTT, Packet Loss e motivo de gargalo).
  * **Smart Zoom (Recorte Livre Ultrawide):** Permite que espectadores em telas $16:9$ apliquem zoom/recorte interativo em transmissões vindas de monitores $21:9$ ou $32:9$, eliminando faixas pretas.
* **Perfis de Captura e Toggle AV1:**
  * Seleção entre **Perfil Fluidez** (`motion` — prioriza $60\text{ FPS}$ constantes para jogos) e **Perfil Nitidez** (`detail` — prioriza resolução nativa intacta para programação, leitura e RPG/VTT).
  * **Toggle Expresso AV1 / VP9 (SVC):** Reduz o consumo de upload em até $50\%$ em GPUs compatíveis, com fallback automático para `H.264`.
* **Moderação pelo Administrador (`👑`):**
  * Clicar no avatar de qualquer membro no Dock inferior permite ao dono da sala: **Encerrar a transmissão ativa**, **Bloquear/Permitir compartilhamento de tela**, **Transferir Host**, **Expulsar (Kick)** ou **Banir da Sala Fixa**.

### Recursos Exclusivos Desktop (Electron)
* **Captura Nativa com Áudio do Sistema:** Seletor de monitores e janelas com loopback limpo de áudio no Windows.
* **PiP Transparente e Click-Through:** Janela flutuante sem bordas, *always-on-top*, com opacidade ajustável ($20\%$ a $100\%$) onde os cliques do mouse atravessam o vídeo direto para o jogo.
* **Gamepad UI:** Navegação nativa por controle (D-Pad, gatilhos e botões) para alternar streams e ajustar volumes sem soltar o gamepad.
* **Replay Buffer:** Atalho global (`Alt + F10`) ou botão no OSD para salvar instantaneamente os últimos $60\text{ segundos}$ da stream assistida em `.mp4`.

---

## 3. Ecossistema de Addons (Isolados por Processo e Sandbox)

Os addons combinam **Bots-Participantes no LiveKit**, sincronização via **Data Channels** (prefixados por `addon:<id>`) e UI em `<iframe sandbox="allow-scripts">` validada por contratos `Zod`:

| Addon | Arquitetura | Experiência na Sala |
| :--- | :--- | :--- |
| **Bot de Música (Spotify / YT Music)** | Container Bot-Participante no servidor publicando faixa Opus estéreo ($256\text{--}320\text{ kbps}$) + Data Channel. | Controlado pela **Gaveta Lateral Retrátil** e pelo **Mini-Player no Header**. Não exige login nem conta Premium dos espectadores e permite ajuste de volume individual por usuário. |
| **YouTube Watch Together** | Slot de UI no palco (`stage-grid`) + sincronia de timestamp via Data Channel. | Entra como **mais um card expansível dentro do Grid do Showroom**, sincronizando `play`, `pause`, `seek` e fila de vídeos para toda a sala. |
| **Soundpad da Galera** | Bot-Participante de áudio + painel lateral/toolbar. | Disparo rápido de efeitos sonoros compartilhados com limite de volume configurável. |
| **Telemetria de Simuladores** | Agente local (C#/Python) lendo SDK/memória do jogo $\rightarrow$ Data Channel ($20\text{ Hz}$) $\rightarrow$ UI Overlay. | Exibe velocímetro, marcha, RPM e pedais sobre o player dos espectadores (*ETS2*, *BeamNG.drive*, *Forza*, *Assetto Corsa*) sem poluir a tela do streamer. |
| **Companion de RPG / VTT** | Eventos via Data Channel + Overlay de dados e presets de ambiente. | Integrado ao **Modo Teatro / Sessão de RPG**, sincroniza rolagens de dados (*Tormenta 20*, *Ordem Paranormal*, *D&D 5e*), trilha sonora e iluminação da interface. |

---

## 4. Arquitetura do Monorepo e Stack Tecnológica

Gerenciado com **pnpm** e **Turborepo**, compartilhando tipagem estrita de ponta a ponta com **TypeScript** e **Zod**:

```text
├── apps/
│   ├── web/            # SPA React + Vite + Tailwind CSS + Zustand (Cliente Navegador)
│   ├── desktop/        # Shell Electron (Main Process, IPC seguro, PiP Click-Through, Gamepad, Tray)
│   └── hub/            # Backend Node.js + Fastify + SQLite (Salas Fixas, CreatorKey Auth, LiveKit JWT, Moderação)
├── packages/
│   ├── contracts/      # Schemas Zod compartilhados (REST, WebSockets, Data Channels, Manifestos de Addons)
│   ├── media-client/   # Wrapper sobre livekit-client (Simulcast, AV1/H264 fallback, Web Audio Boost 200%, HUD Stats)
│   ├── shared-ui/      # Design System React + Tailwind (Lobby, Showroom Grid/Foco, OSD, Smart Zoom, Dock)
│   └── addon-sdk/      # SDK TypeScript para criação de Addons e Bots
├── addons/             # Addons oficiais (music-bot, youtube-grid, soundpad, sim-telemetry, rpg-companion)
├── deploy/             # docker-compose.yml, Caddyfile, livekit.yaml
├── scripts/            # Scripts de validação arquitetural e sincronização do ambiente IA
├── .cline/             # Rules, Skills, Workflows e Hooks de automação do agente IA
└── docs/ai/            # Memória técnica estruturada em camadas (ACTIVE_CONTEXT, ARCHITECTURE, DECISIONS, PROGRESS)
```

### Regras Arquiteturais Críticas (Guardrails)
1. **Desacoplamento Estrito de UI:** `packages/shared-ui` **jamais** importa `electron` ou `livekit-client` diretamente. Toda comunicação externa ocorre via hooks do `media-client` e da interface injetada `PlatformBridge`.
2. **Proibição de Escopo de Voz:** Nenhum token JWT do LiveKit emitido pelo `apps/hub` pode habilitar publicação de microfone (`canPublishSources` restrito a `["screen_share", "screen_share_audio"]`).
3. **Contract-First:** Qualquer nova rota HTTP, mensagem WebSocket, pacote de Data Channel ou manifesto de Addon deve ser definido primeiro em `packages/contracts` com `Zod`.

---

## 5. Requisitos de Rede e Portas (Self-Hosted / VPS)

Toda a pilha de servidor sobe via Docker Compose (`caddy` + `livekit` + `hub` + `addons` opcionais):

* `80/TCP` e `443/TCP+UDP` — Caddy (HTTPS automático e sinalização WebSocket).
* `7882/UDP` — Porta única de mídia RTP (*UDP Mux* do LiveKit) ou faixa `50000-50200/UDP`.
* `7881/TCP` — Fallback de WebRTC via TCP direto.
* `3478/UDP` e `5349/TCP` — Servidor TURN embutido para furar firewalls estritos.

---

## 6. Desenvolvimento, testes e deploy

```bash
pnpm install --frozen-lockfile
pnpm validate:arch
pnpm typecheck
pnpm test
pnpm build
```

Para o passo a passo de execução local, validação, configuração do servidor CasaOS/Linux, serviço systemd do Hub, Docker Compose, firewall e atualizações, consulte o [guia de testes e deploy](./docs/DEPLOYMENT.md).

Em desenvolvimento, `pnpm dev` inicia todos os pacotes, inclusive o Desktop. Para iniciar somente o Hub e a Web, use `pnpm --filter @spectra/hub dev` e `pnpm --filter @spectra/web dev` em terminais separados.

---

## 7. Roadmap Resumido de Execução

* **Fase 0 — Prova de Rede e Mídia:** LiveKit + Caddy via Docker Compose, validando $1080\text{p}60$/$1440\text{p}60$ via UDP direto com $\text{RTT} < 50\text{ ms}$.
* **Fase 1 — MVP Web Funcional:** Monorepo, Hub Fastify + SQLite (Salas Fixas + `CreatorKey`), Lobby 1-Click, Showroom (Grid/Foco), Perfis Fluidez/Nitidez, HUD de Diagnóstico e Moderação no perfil.
* **Fase 2 — Controle Individual e Qualidade:** OSD com Boost $200\%$, Mixer Geral, Seletor de Camadas, Smart Zoom Ultrawide e Toggle Expresso AV1/SVC.
* **Fase 3 — Cliente Desktop (Electron):** Captura nativa com loopback de áudio do Windows, PiP Transparente *Click-Through*, Gamepad UI, System Tray e atalhos globais.
* **Fase 4 — Ecossistema de Addons v1:** Bot de Música $320\text{ kbps}$ (Spotify/YT Music), YouTube no Grid, Soundpad, Telemetria de Simuladores e Modo Teatro / RPG.
* **Fase 5 — Polimento e Pipeline Nativo:** Replay Buffer de $60\text{ s}$, backup automatizado do SQLite e Sidecar Nativo opcional (C#/Rust) para captura direta na GPU.