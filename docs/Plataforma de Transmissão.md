# Documento Mestre de Planejamento, Arquitetura e UX/UI (v2.1 — Definitivo)

---

## Sumário
1. [Matriz de Consolidação e Evolução do Escopo (v1.0 $\rightarrow$ v2.1)](#1-matriz-de-consolidação-e-evolução-do-escopo-v10-rightarrow-v21)
2. [Visão Geral, Premissas e Escopo do Produto](#2-visão-geral-premissas-e-escopo-do-produto)
3. [Requisitos do Sistema e Regras de Negócio](#3-requisitos-do-sistema-e-regras-de-negócio)
4. [Arquitetura de Mídia e Topologia WebRTC](#4-arquitetura-de-mídia-e-topologia-webrtc)
5. [Stack Tecnológica, Monorepo, Autenticação e Modelo de Dados](#5-stack-tecnológica-monorepo-autenticação-e-modelo-de-dados)
6. [Especificação Completa de UX/UI e Fluxos de Interação](#6-especificação-completa-de-uxui-e-fluxos-de-interação)
7. [Sistema de Addons (Arquitetura de Plugins e Bots)](#7-sistema-de-addons-arquitetura-de-plugins-e-bots)
8. [Infraestrutura, Rede e Implantação](#8-infraestrutura-rede-e-implantação)
9. [Segurança, Tratamento de Erros e Resiliência](#9-segurança-tratamento-de-erros-e-resiliência)
10. [Roadmap de Execução e Critérios de Aceitação](#10-roadmap-de-execução-e-critérios-de-aceitação)

---

## 1. Matriz de Consolidação e Evolução do Escopo (v1.0 $\rightarrow$ v2.1)

A tabela abaixo consolida todas as evoluções de arquitetura e produto definidas em relação ao planejamento inicial, eliminando redundâncias e garantindo alinhamento entre engenharia e experiência do usuário:

| Domínio | Escopo Inicial (v1.0) | Decisão Consolidada Definitiva (v2.1) | Impacto Técnico e de Interface |
| :--- | :--- | :--- | :--- |
| **Comunicação por Voz** | Substituir o Discord para voz e vídeo, incluindo captura de microfone e overlay de voz. | **Excluído.** A plataforma é 100% dedicada a **compartilhamento de tela e mídia**. | Remoção de captura de microfone, controles de voz e permissões `microphone` no LiveKit. O áudio da transmissão deve vir apenas da janela/aplicativo escolhido; áudio de Addons é publicado separadamente. |
| **Ciclo de Vida das Salas** | Criação ad-hoc por links temporários. | **Salas Fixas (Persistentes)** com código permanente único gerado automaticamente. | O usuário não precisa inventar um endereço; compartilha o código ou link gerado. A sala permanece no SQLite enquanto a sessão LiveKit é alocada sob demanda e hiberna quando fica vazia. |
| **Identidade e Posse da Sala** | Tokens genéricos de convite/senha sem gestão persistente de identidade. | **Conta persistente por apelido e senha**, sem e-mail ou confirmação por e-mail. | Cadastro confirma a senha e oferece código de recuperação para baixar/copiar; Web e Desktop podem usar contas diferentes e cada conta lista suas salas próprias e as salas em que entrou. |
| **Fluxo de Entrada (Lobby)** | Não especificado. | Hub inicial com seção **Acesso Rápido** (entrada com 1 clique), status ao vivo e campo com *auto-paste*. | Persistência local integrada ao endpoint de consulta rápida de presença no Hub Fastify. |
| **Moderação e Controle** | Menção básica a papéis `admin` e `member`. | Moderação em tempo real via **Menu de Contexto no Avatar** do participante no Dock inferior. | O administrador pode encerrar uma transmissão ativa, bloquear o usuário de compartilhar tela, expulsar (*kick*), banir da sala fixa ou transferir o posto de host. |
| **Addons de Música (Spotify / YT Music)** | Apenas Soundpad básico mencionado. | **Bot-Participante Estéreo no Servidor** (Opus $256\text{--}320\text{ kbps}$) controlado por Gaveta Lateral e Mini-Player. | O container do bot processa o streaming de áudio e publica direto no LiveKit sem compressão de voz, sem bloqueios de DRM de navegador e sem exigir conta Premium dos espectadores. |
| **Addons Visuais, Telemetria e RPG** | Exemplos conceituais de plugins. | **YouTube no Grid**, **Telemetria de Simuladores Veiculares** e **Modo Teatro / Sessão de RPG (VTT)**. | O player do YouTube entra como card expansível no Grid; um agente local (C#/Python) envia telemetria de jogos via Data Channel para HUD dos espectadores; o modo RPG sincroniza clima, áudio e dados. |
| **Qualidade de Vida (QoL)** | Atalhos globais simples e janela transparente básica. | **Smart Zoom Ultrawide**, **PiP Transparente Click-Through**, **Gamepad UI**, **Replay Buffer** e **Toggle Expresso AV1**. | Recorte interativo para monitores $21:9$/$32:9$ vistos em telas $16:9$, navegação completa por controle (D-Pad/botões), gravação instantânea de clipes em RAM e chaveamento direto para codec AV1/SVC. |

---

## 2. Visão Geral, Premissas e Escopo do Produto

### 2.1. Propósito da Plataforma
Plataforma privada e *self-hosted* de compartilhamento de tela de ultra-alta definição e reprodução de mídia sincronizada, projetada para operar lado a lado com o Discord em um grupo fechado de $5$ a $20$ usuários.

### 2.2. Princípios Centrais
*   **Zero Limite Artificial:** Resolução (até 4K), taxa de quadros ($60+$ FPS) e bitrate (até $50\text{ Mbps}$) são limitados exclusivamente pelo hardware (GPU/CPU) e pela largura de banda dos participantes.
*   **Foco Estrito em Tela e Mídia:** Nenhum processamento, captura ou roteamento de microfone é realizado pela aplicação. O áudio da transmissão deve pertencer à janela/aplicativo escolhido; loopback global não pode ser apresentado como captura isolada. Addons podem publicar suas próprias faixas de áudio.
*   **Recepção Independente:** O servidor atua como SFU (*Selective Forwarding Unit*) e não realiza transcodificação de vídeo, poupando CPU e GPU do servidor host. Cada espectador recebe a camada compatível com o tamanho físico da sua janela e velocidade de rede (via Simulcast/SVC), sem degradar a qualidade de quem possui conexão superior.
*   **Salas Fixas sem Fricção:** Cada sala recebe automaticamente um código permanente e único para compartilhar; as salas também ficam salvas na tela inicial dos membros para entrada com um clique.

### 2.3. Fora de Escopo (Non-Goals)
*   Comunicação por voz (VoIP/Microfone), supressão de ruído vocal ou detecção de fala (mantidos no Discord).
*   Escala para milhares de usuários simultâneos ou *multi-tenancy* público.
*   Clusterização complexa com Kubernetes ou Redis.
*   Aplicativos mobile nativos (iOS/Android) e sistemas de cobrança/monetização.

---

## 3. Requisitos do Sistema e Regras de Negócio

### 3.1. Requisitos Funcionais (RF)
*   **RF01 — Criação e Persistência de Salas Fixas:** Qualquer usuário pode criar uma sala fixa informando nome de exibição e visibilidade. O Hub gera um código permanente e único para compartilhar; salas privadas exigem uma senha.
*   **RF02 — Conta por Apelido e Senha:** O usuário deve poder criar uma conta com apelido exclusivo, senha e confirmação de senha, sem exigir e-mail ou confirmação por e-mail. Após o cadastro, deve copiar ou baixar um código de recuperação antes de continuar. O login deve recuperar as salas próprias e as salas em que a conta entrou; “Esqueci minha senha” deve aceitar o código para definir nova senha e emitir um código substituto.
*   **RF03 — Lobby com Salas Frequentes e Status em Tempo Real:** A tela inicial deve exibir cards das salas fixas salvas pelo usuário, informando em tempo real se a sala está vazia ou quantos membros estão presentes e transmitindo no momento.
*   **RF04 — Entrada Rápida e Auto-Paste:** O usuário deve ingressar em uma sala com 1 clique nos cards salvos ou colando o código/link compartilhado no campo de entrada; o Hub resolve o código permanente. Salas privadas continuam exigindo senha.
*   **RF05 — Transmissão Simultânea (Multi-Stream):** Qualquer participante autorizado pode compartilhar sua tela a qualquer momento, permitindo múltiplas transmissões simultâneas no palco da sala.
*   **RF06 — Configuração Granular de Captura:** Antes de iniciar a transmissão, o usuário deve selecionar a fonte (monitor inteiro ou janela específica), escolher o perfil funcional (**Fluidez** ou **Nitidez**), a resolução máxima (`720p`, `1080p`, `1440p`, `4K`), bitrate (`até 50 Mbps`) e FPS (`15`, `30`, `60`). O áudio deve ser isolado à janela/aplicativo escolhido quando a plataforma suportar; nunca usar loopback global como fallback.
*   **RF07 — Palco Dinâmico com Foco por Seleção:** O palco deve abrir em grade responsiva com transmissões ativas. Ao clicar em uma transmissão, ela permanece fixa no painel principal; as demais ficam em uma coluna lateral menor com rolagem própria. Tela cheia ocupa a área física disponível sem mudar qual transmissão está em foco.
*   **RF08 — Controles Individuais de Espectador (OSD):** Cada espectador deve controlar individualmente na sua máquina: volume de cada transmissão ($0\%$ a $200\%$ com amplificação via Web Audio API), mudo local, camada de qualidade (`Auto`, `Original`, `1080p`, `720p`), **Smart Zoom** (recorte livre para monitores Ultrawide), Modo Teatro, Tela Cheia e HUD de estatísticas técnicas.
*   **RF09 — Moderação pelo Administrador:** Clicando no perfil/avatar de um participante no Dock inferior, o administrador da sala deve poder:
    1. Encerrar imediatamente a transmissão de tela ativa daquele usuário.
    2. Bloquear ou desbloquear a permissão do usuário de abrir novas transmissões na sala.
    3. Expulsar (*Kick*) o usuário da sessão atual.
    4. Banir o usuário da sala fixa.
    5. Transferir a administração (*Host*) da sala para outro membro presente.
*   **RF10 — Bot de Música de Alta Fidelidade (Spotify / YouTube Music):** A sala deve contar com um Bot-Participante executado no servidor que processa faixas/playlists do Spotify e YouTube Music e injeta áudio estéreo ($256\text{--}320\text{ kbps}$ Opus) diretamente na sala do LiveKit, controlado por uma gaveta lateral retrátil e um Mini-Player no cabeçalho.
*   **RF11 — Addons Visuais, Telemetria e RPG:** Suporte nativo a player do YouTube integrado como card no Grid, overlays de telemetria em tempo real para simuladores veiculares e Modo Teatro / Sessão de RPG com sincronia de dados e ambiência.
*   **RF12 — Recursos Exclusivos do Cliente Desktop (Electron):** Seletor visual nativo de telas/janelas e captura de áudio isolada por aplicativo no Windows (não loopback global), janela *Picture-in-Picture* (PiP) transparente e *click-through*, navegação completa por controle (*Gamepad UI*), atalhos globais de teclado e *Replay Buffer* para salvar clipes locais dos últimos $60\text{ segundos}$.

### 3.2. Requisitos Não Funcionais (RNF)
*   **RNF01 — Desempenho de Rede e Latência:** Conexão de mídia via UDP direto sempre que possível, mantendo $\text{RTT} < 50\text{ ms}$ e latência visual ponta a ponta $< 200\text{ ms}$ na internet (ou $< 100\text{ ms}$ em LAN).
*   **RNF02 — Independência de Qualidade entre Espectadores:** Um espectador com limitação severa de banda (ex: $6\text{ Mbps}$) deve transicionar sozinho para a camada `720p` sem causar travamentos, perda de qualidade ou geração excessiva de *keyframes* para os espectadores em `4K`/`1440p`.
*   **RNF03 — Qualidade de Áudio Musical e de Jogos:** As faixas de áudio publicadas por transmissões de tela e pelo Bot de Música devem operar com perfil `music/high-quality` do codec Opus em estéreo ($48\text{ kHz}$, até $320\text{ kbps}$), com filtros de voz (`echoCancellation`, `noiseSuppression`, `autoGainControl`) estritamente desativados.
*   **RNF04 — Isolamento de Falhas de Addons:** Uma falha, lentidão ou queda de um container de bot ou `iframe` de addon jamais deve interromper a transmissão de vídeo principal ou travar a interface do cliente.
*   **RNF05 — Consumo Zero em Hibernação:** Salas fixas vazias devem manter apenas seu registro no SQLite, sem alocar processos de mídia ou tráfego de rede no LiveKit.

### 3.3. Regras de Negócio (RN)
*   **RN01 — Alocação Efêmera sobre Persistência Fixa:** O registro da sala no banco SQLite é permanente. Quando o $1^\circ$ participante solicita entrada no Hub, o backend garante a criação da sessão ativa no LiveKit. Quando o último participante sai, inicia-se um *grace period* de $5\text{ minutos}$; se ninguém retornar nesse intervalo, a sessão de mídia no LiveKit e eventuais bots ativos naquela sala entram em hibernação automaticamente.
*   **RN02 — Restrição Estrita de Fontes no JWT:** Todo token LiveKit emitido para usuários humanos contém `canPublishSources: ["screen_share", "screen_share_audio"]` (quando `can_share_screen = true`) e `canPublishData: true`. A fonte `"microphone"` e `"camera"` são bloqueadas por padrão no token.
*   **RN03 — Revogação Imediata de Stream:** Quando o administrador aciona *"Encerrar Transmissão"* ou *"Bloquear Compartilhamento"* sobre um membro, o Hub invoca a API administrativa do LiveKit (`RemovePublishedTrack` / `UpdateParticipant`) em tempo real, cortando o fluxo de vídeo imediatamente no servidor SFU sem depender da cooperação do cliente do usuário punido.

---

## 4. Arquitetura de Mídia e Topologia WebRTC

### 4.1. Topologia: SFU com LiveKit (Self-Hosted)
*   **Por que SFU e não P2P Mesh:** Em P2P, transmitir a $25\text{ Mbps}$ para $8$ amigos exigiria $200\text{ Mbps}$ de upload constante e múltiplos processos de codificação no PC do streamer. No modelo SFU (*Selective Forwarding Unit*), o streamer envia o fluxo uma única vez para o servidor, que apenas roteia os pacotes RTP em memória para os espectadores.
*   **Por que LiveKit (em vez de Mediasoup/Pion puro):** Binário único em Go, extremamente leve, já inclui servidor TURN embutido, gerenciamento de salas, Data Channels, Webhooks, autenticação via JWT e SDKs prontos para TypeScript, Python, Rust, Go e C#.

### 4.2. Qualidade Adaptativa por Espectador
1.  **Simulcast no Transmissor:** Para compartilhamento de tela H.264, o cliente publica a camada original e uma camada reduzida, sujeitas ao suporte do navegador/encoder. O bitrate escolhido é o teto agregado das camadas, não um limite por camada.
2.  **Dynacast:** Se todos os amigos estiverem assistindo em `4K` (Modo Foco), o LiveKit instrui o cliente transmissor a pausar a codificação das camadas de `1080p` e `720p`, poupando GPU e upload do streamer.
3.  **AdaptiveStream:** O player do espectador informa ao SFU o tamanho físico da janela de vídeo. Enquanto as transmissões estão divididas no Grid ou minimizadas na barra secundária, o servidor envia automaticamente a camada de `720p`/`360p`. Ao clicar para expandir no Modo Foco, o SFU chaveia instantaneamente para a camada `Original`.
4.  **Controle do Espectador (Auto vs. Manual):** O espectador pode travar manualmente a camada desejada (`Original`, `1080p`, `720p`) ou deixar no `Automático`. Se a camada pedida não existir na publicação atual, o cliente seleciona a camada imediatamente inferior e exibe um aviso claro na UI.

### 4.3. Codecs, Perfis de Captura e Presets de Bitrate

#### Perfis Funcionais (`contentHint` do WebRTC)
*   **Perfil Fluidez (`motion`):** Prioriza manter $60\text{ FPS}$ constantes. Ideal para gameplays, simuladores e vídeos de ação.
*   **Perfil Nitidez (`detail` / `text`):** Prioriza manter a resolução intacta para legibilidade perfeita de textos, reduzindo FPS se a banda oscilar. Ideal para programação, leitura, planilhas ou sessões de RPG em VTT.

#### Estratégia de Codecs e Toggle Expresso
*   **Padrão Universal (`4K60` / `1440p60`):** `H.264` com Simulcast da camada original e uma camada reduzida. O bitrate escolhido é repartido entre as camadas e limitado pelo congestionamento WebRTC.
*   **Toggle de Alta Eficiência (`AV1` ou `VP9` com SVC):** O cliente só tenta o codec se a verificação de suporte do LiveKit passar. Para screen share, o SDK usa `L1T3` (uma camada espacial e camadas temporais), não múltiplas camadas espaciais; se o codec ou publicação falhar, tenta `H.264`. Ganho de banda/latência depende do encoder e precisa ser medido em hardware real.

#### Tabela de Presets Iniciais (Calibráveis via UI)

| Resolução de Captura | Bitrate total recomendado a 60 FPS | Camada original H.264 | Camada reduzida H.264 |
| :--- | :--- | :--- | :--- |
| **4K** | $35\text{ Mbps}$ | $\sim 28\text{ Mbps}$ | $\sim 7\text{ Mbps}$ |
| **1440p** | $20\text{ Mbps}$ | $\sim 16\text{ Mbps}$ | $\sim 4\text{ Mbps}$ |
| **1080p** | $12\text{ Mbps}$ | $\sim 9.6\text{ Mbps}$ | $\sim 2.4\text{ Mbps}$ |

> **Nota de Engenharia (Limites de Hardware e Monitores Ultrawide):** As constraints de captura aplicam teto à resolução e ao FPS selecionados; o encoder ainda pode entregar menos conforme hardware/rede. A camada reduzida H.264 mantém o *aspect ratio* capturado. Os valores da tabela são alvos de bitrate agregado, não garantias; validar em cada encoder e rede.

---

## 5. Stack Tecnológica, Monorepo, Autenticação e Modelo de Dados

### 5.1. Tecnologias Escolhidas
*   **Gerenciamento de Monorepo:** TypeScript gerenciado com `pnpm` e `Turborepo`.
*   **Backend (Hub de Controle):** Node.js + TypeScript + Fastify (baixíssima latência, suporte nativo a WebSockets e validação rápida de schemas).
*   **Banco de Dados:** SQLite (via `better-sqlite3` ou Drizzle ORM) persistido em volume Docker (`./data:/app/data`). Para $20$ usuários, elimina a necessidade de gerenciar PostgreSQL ou Redis.
*   **Validação e Contratos:** `Zod`. Garante tipagem em tempo de compilação e execução para chamadas HTTP, eventos de WebSocket, Data Channels e manifestos de addons.
*   **Frontend (Web & Desktop UI):** React + Vite + TypeScript + Tailwind CSS + Zustand (gerenciamento de estado leve e reativo para salas, streams, mixer de áudio e addons).
*   **Cliente Desktop:** Electron. Diferente do Tauri (que sofre com inconsistências de WebView2/WebKitGTK no WebRTC e captura de tela), o Electron embarca o mesmo Chromium da versão Web, garantindo paridade no WebRTC e acesso ao `desktopCapturer`. Captura de áudio no Desktop só será habilitada quando for isolada por aplicativo; loopback global não é fallback. O shell também dá suporte a atalhos globais, System Tray, janelas PiP transparentes *click-through*, Gamepad e aceleração de GPU.
*   **Rota de Escape Nativa (Opcional / Fase 5):** Caso o WebRTC interno do Chromium apresente gargalo de bitrate ou uso de CPU em `4K60`, o cliente Electron será acoplado a um **Sidecar Nativo** (escrito em C#/.NET ou Rust) que captura a tela via *Windows Graphics Capture API*, codifica direto na GPU (NVENC) e publica na sala como um participante via SDK nativo do LiveKit, mantendo toda a UI no Electron.

### 5.2. Arquitetura do Monorepo

```text
├── apps/
│   ├── web/            # SPA React servida para navegadores
│   ├── desktop/        # Shell Electron (Main Process, IPC seguro, Tray, PiP/Overlays, Gamepad/Sidecar bridge)
│   └── hub/            # Backend Fastify + SQLite (contas, salas fixas, tokens LiveKit e moderação)
├── packages/
│   ├── contracts/      # Schemas Zod compartilhados (Eventos, API, Manifestos, Moderação, Configurações)
│   ├── media-client/   # Wrapper sobre livekit-client (Simulcast, AV1/H264, Audio Boost, Telemetria, Reconnect)
│   ├── shared-ui/      # Design System React + Tailwind (Lobby, Grid/Foco, Controles OSD, Smart Zoom, HUD)
│   └── addon-sdk/      # SDK TypeScript para criação rápida de Addons e Bots
├── addons/             # Addons oficiais (Music Bot Spotify/YT, YouTube Grid, Soundpad, Telemetria, RPG, Replay)
└── deploy/             # docker-compose.yml, Caddyfile, livekit.yaml
```

*   **Regra de Ouro de Desacoplamento:** Os componentes visuais em `shared-ui` nunca importam o `electron` ou o `livekit-client` diretamente. Eles consomem hooks expostos pelo `media-client` e por uma interface `PlatformBridge` (injetada via `contextBridge` no Electron ou Web APIs no navegador).

### 5.3. Autenticação por Apelido e Senha
Cada usuário cria uma conta persistente sem e-mail ou confirmação por e-mail:

1.  **Cadastro:** O usuário informa apelido exclusivo e senha duas vezes; o Hub normaliza o apelido e armazena o hash da senha com `scrypt`.
2.  **Login:** A mesma combinação de apelido e senha recupera a identidade em qualquer cliente. Web e Desktop podem usar contas diferentes; compartilhar as credenciais significa acessar a mesma conta.
3.  **Salas da Conta:** Cada sala tem `owner_user_id`; o Hub lista salas próprias e salas em que o usuário autenticado entrou. Salas públicas ainda podem ser acessadas por convite, e a entrada autenticada registra o vínculo de membro.
4.  **Código de Recuperação:** O Hub gera um código aleatório de 256 bits e guarda apenas seu HMAC. A tela pós-cadastro permite copiar ou baixar um arquivo `.txt` e exige confirmação de que o usuário salvou o código; se a página for fechada antes, login/retomada emite um novo código até ser confirmado.
5.  **Redefinição:** A tela “Esqueci minha senha” recebe apelido, código e nova senha confirmada. O código anterior é substituído após sucesso, e o novo precisa ser salvo.
6.  **Token Interno:** Após login, o Hub emite um token persistente interno para as rotas existentes. Ele é armazenado localmente pelo cliente, mas não é mostrado como senha nem como código de recuperação.

### 5.4. Modelo de Dados (Schema SQLite no Hub)

```sql
-- 1. Identidade de Usuários (conta por apelido e senha)
CREATE TABLE users (
  id TEXT PRIMARY KEY,                      -- UUID v4
  identity TEXT NOT NULL UNIQUE,            -- Identidade interna do participante
  display_name TEXT NOT NULL,               -- Apelido atual exibido na sala
  secret_token_hash TEXT NOT NULL,          -- Hash do token interno de sessão
  username_key TEXT,                        -- Apelido normalizado (único quando preenchido)
  password_hash TEXT,                       -- Hash scrypt da senha
  recovery_code_hash TEXT,                  -- HMAC do código, nunca o código em texto puro
  recovery_code_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_users_username_key
  ON users (username_key) WHERE username_key IS NOT NULL;

-- 2. Salas Fixas (Persistentes)
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,                      -- UUID v4
  slug TEXT NOT NULL UNIQUE,                -- Identificador interno da sessão de mídia
  room_code TEXT NOT NULL UNIQUE,           -- Código permanente gerado e compartilhável
  name TEXT NOT NULL,                       -- Nome amigável (ex: 'Sala da Galera')
  owner_user_id TEXT NOT NULL,              -- Criador / Admin principal (FK -> users.id)
  password_hash TEXT,                       -- Hash de senha/PIN opcional (NULL se aberta ao link)
  default_layout_preset TEXT DEFAULT 'standard', -- 'standard' | 'rpg_theater'
  addon_control_mode TEXT DEFAULT 'democratic',  -- 'democratic' | 'host_only'
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

-- 3. Permissões, Moderação e Restrições por Sala
CREATE TABLE room_permissions (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',      -- 'admin' | 'member'
  can_share_screen INTEGER NOT NULL DEFAULT 1, -- 1 = Permitido, 0 = Bloqueado pelo Admin
  is_banned INTEGER NOT NULL DEFAULT 0,     -- 1 = Banido da Sala Fixa, 0 = Normal
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Configuração de Addons Habilitados na Sala Fixa
CREATE TABLE room_addons (
  room_id TEXT NOT NULL,
  addon_id TEXT NOT NULL,                   -- Ex: 'media.music-bot', 'media.youtube-grid'
  is_enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',   -- Configurações persistidas (validado via Zod)
  PRIMARY KEY (room_id, addon_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);
```

---

## 6. Especificação Completa de UX/UI e Fluxos de Interação

### 6.1. Tela Inicial (Lobby & Hub de Salas Fixas)
A tela inicial prioriza o acesso imediato às salas fixas do grupo com zero fricção:

```text
+---------------------------------------------------------------------------------+
|  [Logo StreamHub]                   [👤 Marcos (Chave Ativa 🔑)] [Configurações ⚙️] |
+---------------------------------------------------------------------------------+
|                                                                                 |
|   Suas Salas Fixas / Frequentes                         [ + Criar Nova Sala ]   |
|   +----------------------------------+  +----------------------------------+    |
|   | 🟢 Sala da Galera          [👑]  |  | ⚪ Sessão de RPG / Cinema         |    |
|   | Código ABCD2345EF [Copiar link] | | Código HJKM6789PR [Copiar link] |
|   | 🔴 2 transmitindo • 👁️ 3 na sala  |  | Sala em hibernação (0 na sala)   |    |
|   | [ Entrar Direto (1-Click) ]      |  | [ Acordar e Entrar ]             |    |
|   +----------------------------------+  +----------------------------------+    |
|                                                                                 |
|   Entrar em Outra Sala por Link ou Código (Auto-Paste)                          |
|   [ Cole o link ou digite o código da sala ] [ Encontrar sala ]                |
|                                                                                 |
+---------------------------------------------------------------------------------+
```

*   **Sincronização de Favoritos:** As salas que o usuário criou (marcadas com a coroa `👑`) e as salas em que ele já entrou ficam salvas localmente e associadas ao ID da conta.
*   **Status ao Vivo:** O Lobby consulta o Hub periodicamente para exibir quantos amigos estão conectados (`👁️`) e quantos estão com tela aberta (`🔴`) em cada sala fixa antes mesmo de o usuário entrar.
*   **Modal de Perfil (`👤`):** Exibe a conta conectada e permite sair; dados da conta e salas são recuperados após login.

### 6.2. Anatomia da Tela da Sala (Foco em Vídeo, Sem Microfone)
A tela da sala é dividida em **Header Superior**, **Área do Showroom (Palco)**, **Gaveta Lateral Retrátil (Addons)** e **Dock Inferior de Participantes**:

```text
+---------------------------------------------------------------------------------+
| [● Ao Vivo] Sala da Galera | Código ABCD2345EF [📋] | 🟢 18ms | 🎵 M83 - Midnight [⏯][⏭] | [📊 HUD] [⚙️] |
+---------------------------------------------------------------------------------+
|                                                      | (Gaveta Retrátil Addon)  |
|              ÁREA DO SHOWROOM (PALCO)                |  [ Bot Spotify / YT ]    |
|                                                      |  ▶ Tocando Agora (320k)  |
|     (Modo Grid 1..N streams OU 1 Stream em Foco)     |  Fila de Reprodução:     |
|                                                      |  1. Resonance - HOME     |
|                                                      |  2. Starboy - The Weeknd |
|                                                      |  [+ Colar Link / Buscar] |
+------------------------------------------------------+--------------------------+
| DOCK INFERIOR (Participantes + Controles):                                      |
| Membros: [👑 Marcos 🔴] [João 🔴] [Pedro 👁️] [Lucas 👁️] [🚫 Caio (Sem Stream)]  |
| Ações:   [ 🖥️ Compartilhar Tela ]   [ 🧩 Addons ]   [ 🔊 Mixer Geral ]   [ 🚪 Sair ]|
+---------------------------------------------------------------------------------+
```

#### Comportamento do Showroom (Grade e foco por clique)
1.  **Modo Grid (Visualização Múltipla):**
    *   Exibe todas as transmissões ativas (e o card do YouTube, quando ativo) dividindo o espaço igualmente ($1\text{ stream} = 100\%$, $2\text{ streams} = 50/50$, $3\text{ a }4\text{ streams} = \text{Grid } 2 \times 2$).
    *   Cada card no Grid requisita automaticamente a camada intermediária (`720p` ou `1080p`) ao SFU via `AdaptiveStream`.
2.  **Transmissão em Foco:**
    *   Ao clicar em uma transmissão, ela ocupa o painel principal e permanece estática enquanto a coluna lateral é rolada.
    *   O player solicita instantaneamente a camada `Original` (`4K60` / `1440p60`) ao LiveKit.
    *   As demais transmissões ativas ficam alinhadas em uma coluna menor, rolável, à direita. Uma ação separada retorna à grade.
3.  **Tela Cheia:** O botão de tela cheia amplia a sala ou o player escolhido para ocupar a tela, sem alterar a seleção de foco.

### 6.3. Controles Essenciais na Transmissão (Player OSD)
Ao mover o mouse sobre a transmissão em foco, o overlay OSD exibe os controles essenciais de experiência do usuário (ocultando-se após $2.5\text{ segundos}$ sem movimento):

*   **Controle de Volume Individual ($0\%$ a $200\%$):** Slider com amplificação via `GainNode` (Web Audio API) para aumentar o som de jogos baixos, além de botão de *Mute* local com 1 clique.
*   **Seletor de Qualidade (Camadas Simulcast/SVC):** Permite escolher entre `Automático`, `Original (4K/1440p)`, `1080p60` e `720p60`.
*   **Smart Zoom para Ultrawide ($21:9$ / $32:9$):** Permite alternar entre `Ajustar (Fit)`, `Preencher (Fill)` e **`Recorte Livre (Smart Zoom)`**, onde o espectador dá duplo clique ou seleciona um retângulo da tela transmitida para dar zoom na área principal do jogo/código, eliminando as barras pretas em monitores $16:9$.
*   **Pop-out / PiP Transparente:** Destaca a transmissão para uma janela flutuante. No cliente Desktop (Electron), a janela PiP não tem bordas, fica sempre no topo (*always-on-top*), possui slider de opacidade ($20\%$ a $100\%$) e botão **Click-Through** para assistir enquanto joga no mesmo monitor.
*   **Modo Teatro e Tela Cheia:** O **Modo Teatro** esconde o Header e transforma o Dock inferior em uma barra oculta que desliza ao passar o mouse; a **Tela Cheia** (`F` ou duplo clique) ocupa 100% do monitor físico.
*   **Botão de Clipe Instantâneo (Replay Buffer):** Salva imediatamente os últimos $60\text{ segundos}$ daquela transmissão em arquivo `.mp4` local.
*   **HUD de Diagnóstico (*Stats for Nerds*):** Exibe um card translúcido com Resolução atual, FPS efetivo, Bitrate em Mbps, Codec (`H.264`/`AV1`), RTT/Jitter, Perda de Pacotes e indicador de gargalo (`CPU Limited` vs. `Bandwidth Limited`).

### 6.4. Fluxo de Moderação pelo Perfil do Participante
Quando qualquer usuário clica no perfil/avatar de um participante no Dock inferior, abre-se o popover de ajustes locais (volume individual da stream daquela pessoa, focar na stream ou abrir em PiP).

Quando o **Administrador da Sala (`👑`)** clica no perfil de um participante, o popover exibe adicionalmente a seção administrativa:
*   **`[ 🛑 Encerrar Transmissão ]`:** Corta imediatamente o compartilhamento de tela atual do participante via API do Hub/LiveKit.
*   **`[ 🚫 Permitir / Bloquear Compartilhamento ]`:** Switch que revoga ou devolve a permissão `canPublish` do participante. Enquanto bloqueado, o membro continua na sala assistindo aos amigos, mas seu botão de compartilhar tela fica travado.
*   **`[ 👑 Transferir Administração ]`:** Transfere o controle da sala para o membro selecionado.
*   **`[ 👢 Expulsar da Sala (Kick) ]`:** Desconecta o usuário imediatamente da sessão atual.
*   **`[ 🔨 Banir da Sala Fixa ]`:** Desconecta e impede novas entradas daquele usuário na sala fixa.

---

## 7. Sistema de Addons (Arquitetura de Plugins e Bots)

O sistema de addons opera isolado em nível de processo e agnóstico de linguagem, combinando **Bots-Participantes no LiveKit**, **Sincronização via Data Channels** e **Interfaces em `<iframe sandbox="allow-scripts">`** validadas com `Zod`.

### 7.1. Arquitetura do Bot de Música (Spotify & YouTube Music)
Conforme definido para eliminar as limitações de qualidade do Discord e evitar problemas de login ou DRM nos navegadores dos espectadores, o addon de música opera no modelo **Server-Side Bot-Participant**:

```text
[Interface React (Gaveta Lateral)] 
       │ (1. Comando via WebSocket / Data Channel: play, pause, skip, addUrl)
       ▼
[Container: addon-music-bot (Node.js / Python / Go)]
       ├── Extrai/Processa stream de áudio (Spotify Librespot / YT-DLP + FFmpeg em memória)
       ├── Codifica em Opus Estéreo 48kHz @ 256-320 kbps (dtx: false, red: false, stereo: true)
       ▼ (2. Publica faixa de áudio dedicada via LiveKit SDK)
[Servidor SFU LiveKit] ──► Roteia áudio cristalino para todos os membros da sala
```

*   **Experiência Zero-Login para Espectadores:** Nenhum participante precisa logar no Spotify ou ter conta Premium no navegador. O bot entra na sala como um participante oculto de mídia (`addon:media.music-bot`) e publica uma faixa de áudio estéreo pura.
*   **Sincronização Perfeita e Estado:** O bot transmite via Data Channel (`addon:media.music-bot`) o metadado atual (título da música, artista, capa do álbum, duração total, segundo atual e fila de reprodução).
*   **Controle Local de Volume:** Como o áudio chega como uma *Track* independente do LiveKit, cada espectador regula o volume da música de $0\%$ a $200\%$ no seu próprio Mixer ou no Mini-Player do Header, sem afetar o volume da música para os demais amigos.
*   **Política de Fila:** Respeita a configuração da Sala Fixa (`Democrático`, onde qualquer amigo adiciona músicas e avança faixas, ou `Host-Only`, onde apenas administradores gerenciam a fila).

### 7.2. Demais Addons Oficiais da Plataforma

1.  **YouTube Watch Together (Slot no Grid):**
    *   Diferente do bot apenas de áudio, o addon de vídeo do YouTube é renderizado diretamente como **um card dentro do Grid do Showroom** (podendo ser expandido no Modo Foco ou Tela Cheia exatamente como a tela de um amigo).
    *   Sincroniza eventos de `play`, `pause`, `seek` (`currentTime` com tolerância de *drift* $< 250\text{ ms}$) e fila de vídeos via Data Channels (`addon:media.youtube`).
2.  **Soundpad da Galera:**
    *   Bot-Participante de áudio + painel na gaveta lateral para disparo rápido de áudios curtos e memes da galera, com trava de volume máximo definida no `manifest.json`.
3.  **Telemetria de Simuladores Veiculares (Overlay Contextual):**
    *   Agente leve local (escrito em C# ou Python) executado na máquina do streamer que lê a memória compartilhada / SDK de simuladores (*Euro Truck Simulator 2*, *BeamNG.drive*, *Forza Horizon*, *Assetto Corsa*).
    *   Publica pacotes enxutos ($20\text{ Hz}$) via Data Channel (`addon:sim.telemetry`) contendo velocidade, RPM, marcha, posição do volante/pedais e coordenadas.
    *   Os espectadores podem ativar no OSD um overlay vetorial limpo sobre o vídeo, visualizando o painel do veículo sem que o streamer precise jogar com HUD poluído.
4.  **Companion de RPG / Modo Teatro (VTT):**
    *   Sincroniza rolagens de dados (*Tormenta 20*, *Ordem Paranormal*, *D&D 5e*) exibindo notificações estilizadas (*toasts*) sobre a transmissão e aplica presets de ambiente (mudando simultaneamente a trilha sonora do Bot de Música, efeitos climáticos na borda da tela e iluminação da interface para todos os jogadores).
5.  **Replay Buffer (Clipes Instantâneos):**
    *   No cliente Electron (ou via Bot assinante no servidor), mantém um buffer circular em memória dos últimos $60\text{ segundos}$ da stream assistida, salvando o vídeo em disco com 1 clique ou via atalho global (`Alt + F10`).

---

## 8. Infraestrutura, Rede e Implantação

### 8.1. Topologia de Containers (Docker Compose)
Toda a pilha é implantada com `docker compose up -d`:
*   `caddy`: Proxy reverso e automação de certificados TLS/HTTPS (obrigatório para `getDisplayMedia` funcionar nos navegadores).
*   `livekit`: Servidor SFU com configuração de portas UDP diretas e servidor TURN integrado.
*   `hub`: API Fastify + SQLite (persistido em `./data:/app/data`) + arquivos estáticos do cliente Web.
*   `addon-music-bot` e `addon-soundpad`: Containers de bots gerenciados via Docker Compose Profiles (`docker compose --profile addons up -d`).

### 8.2. Requisitos de Rede e Regras de Firewall
Portas abertas no Host/Firewall para garantir mídia via UDP direto:
*   `80/TCP` e `443/TCP+UDP`: Caddy HTTPS / HTTP3 / Sinalização WebSocket.
*   `7881/TCP`: Fallback de WebRTC via TCP direto no LiveKit.
*   `7882/UDP` (usando *UDP Mux* do LiveKit em porta única) **ou** faixa `50000-50200/UDP` para tráfego RTP de mídia.
*   `3478/UDP` e `5349/TCP`: TURN Server embutido para espectadores em redes móveis ou corporativas restritas.

### 8.3. Estratégia de Hospedagem (Trade-off de Banda vs. Latência)
O uso de CPU do LiveKit para $20$ pessoas é mínimo ($1$ a $2$ vCPUs); o fator determinante é a banda de saída (*Egress*) e o RTT:
*   **Cálculo Realista:** $1$ streamer em `1440p60` ($25\text{ Mbps}$) assistido por $2$ amigos em `1440p` ($50\text{ Mbps}$) + $4$ amigos em `1080p` ($40\text{ Mbps}$) = **$90\text{ Mbps}$ de saída constante** ($\sim 40\text{ GB/hora}$).
*   **Opção 1 — Self-Hosted Local (PC do Host ou Home Server):** Custo zero, franquia de tráfego ilimitada e latência de $20\text{ ms}$ a $50\text{ ms}$ na mesma região. Requer fibra óptica com $200\text{--}300\text{ Mbps}$ de upload real e IP Público roteável (sem CGNAT na porta UDP do LiveKit).
*   **Opção 2 — VPS no Brasil (São Paulo - ex: Oracle Cloud Free Tier ARM / VPS Local):** IP fixo e disponibilidade 24/7 para as Salas Fixas, com RTT de $15\text{ ms}$ a $40\text{ ms}$ em SP. Requer monitoramento da franquia mensal de tráfego (*Egress*) e porta de rede de $1\text{ Gbps}$.

---

## 9. Segurança, Tratamento de Erros e Resiliência

*   **Isolamento de Sandboxing e Contratos Zod:** Nenhum addon tem acesso ao DOM principal ou à `CreatorKey` do usuário. Todo tráfego de `postMessage` (UI) e Data Channels (`addon:<id>`) passa por validação de schema `Zod`, descartando pacotes malformados.
*   **Proteção contra Sobrecarga de Encoder (GPU Overload):** Se o cliente detectar limitação contínua de hardware (`qualityLimitationReason === "cpu"`) ao codificar $3$ camadas em `4K60`, o `media-client` desativa automaticamente a $3^\text{a}$ camada Simulcast, preservando a fluidez de $60\text{ FPS}$ na camada principal.
*   **Fallback Transparente de Codec (`AV1` / `VP9` $\rightarrow$ `H.264`):** Se o codec não estiver listado nas capacidades do navegador ou sua publicação falhar, o cliente tenta `H.264` e informa o fallback no OSD. O tempo depende da negociação e do encoder; não há garantia de menos de $1\text{ segundo}$.
*   **Resiliência de Rede e Hibernação Segura:** A conexão inicial tem até três tentativas limitadas; em quedas após conectar, o SDK LiveKit gerencia a reconexão e a interface exibe o estado. O *grace period* de $5\text{ minutos}$ impede que o estado dos addons (como a fila atual do Bot de Música) seja perdido caso todos os membros sofram uma oscilação simultânea.

---

## 10. Roadmap de Execução e Critérios de Aceitação

### Fase 0: Prova de Rede e Engenharia de Mídia (Dias 1 a 2)
*   **Entregas:** Subir LiveKit + Caddy via Docker Compose no host escolhido com domínio configurado e validar transmissão de alta taxa de bits.
*   **Critério de Aceite:** Transmitir em `1080p60` e `1440p60` ($15\text{--}25\text{ Mbps}$) para $3$ a $5$ amigos simultâneos (com voz no Discord), confirmando conexão via UDP direto, $\text{RTT} < 50\text{ ms}$ e latência visual $< 200\text{ ms}$ na internet ($< 100\text{ ms}$ em LAN).

### Fase 1: MVP Web com Salas Fixas, Chave Persistente e Moderação (Semanas 1 a 2)
*   **Entregas:**
    *   Monorepo (`pnpm` + `Turborepo`) com `contracts`, `media-client`, `shared-ui`, `hub` e `web`.
    *   Hub Fastify + SQLite com **contas por apelido e senha**, código de recuperação, Salas Fixas e controle de permissões (`admin` vs. `member`).
    *   Lobby com Cards de Salas Frequentes (status ao vivo e entrada com 1 clique) e *auto-paste*.
    *   Tela da Sala com grade automática, foco por clique, coluna lateral rolável e tela cheia independente; Dock inferior sem controles de voz.
    *   Compartilhamento com seletor de tela/janela, Perfis (**Fluidez**/**Nitidez**), bitrate/FPS ajustáveis, Simulcast, `adaptiveStream` e `dynacast`. Áudio por janela depende de suporte da plataforma; nunca usar loopback global como fallback.
*   **Critério de Aceite:** Sessão real de $2+\text{ horas}$ pelo navegador usando uma Sala Fixa salva, validando múltiplas transmissões simultâneas, troca de foco, redefinição de senha pelo código de recuperação e moderação em tempo real.

### Fase 2: OSD Avançado, Smart Zoom Ultrawide, AV1 e Resiliência (Semana 3)
*   **Entregas implementadas:** OSD com boost/mudo local, mixer geral, seletor individual de camada, HUD técnico, Smart Zoom com Ajustar/Preencher/Recorte, toggle H.264/VP9/AV1 SVC com fallback, tentativas limitadas de conexão inicial e reconexão pós-conexão gerenciada pelo LiveKit.
*   **Validação pendente:** O critério de aceite ainda exige teste real de stream `4K60`/Ultrawide e rede limitada a `6 Mbps`, incluindo confirmação de que o espectador limitado recebe `720p` sem alterar a qualidade `Original` dos demais.

### Fase 3: Cliente Desktop em Electron, PiP Click-Through e Gamepad UI (Semanas 4 a 5)
*   **Entregas:**
    *   App Electron empacotando a UI com `PlatformBridge` isolado, System Tray, atalhos globais e flags de Hardware Encode (NVENC/AMF).
    *   Seletor visual nativo de telas/janelas; áudio isolado por aplicativo no Windows (não loopback global) permanece pendente.
    *   Janela **PiP Transparente e Click-Through** (*always-on-top*, sem bordas, opacidade regulável).
    *   **Gamepad UI** para navegação pelo Grid, foco de stream e ajuste de volume usando controle.
*   **Critério de Aceite:** Jogo transmitido em tela cheia (`1440p60`/`4K60`) pelo app Desktop com áudio limpo, enquanto um amigo assiste via janela PiP transparente *click-through* sobre o próprio jogo e controla a interface pelo gamepad.

### Fase 4: Arquitetura de Addons v1 — Bot de Música, YouTube, Telemetria e RPG (Semanas 6 a 7)
*   **Entregas:**
    *   Infraestrutura de Addons no Hub (validação de manifestos `Zod`, tokens restritos, Data Channels prefixados e slots `sidebar`, `stage-grid` e `overlay`).
    *   **Bot de Música (Spotify / YouTube Music):** Container injetando áudio Opus estéreo $320\text{ kbps}$ no LiveKit, controlado pela Gaveta Lateral e Mini-Player no Header.
    *   **YouTube Watch Together** integrado como card expansível no Grid e **Soundpad Bot**.
    *   **Modo Teatro / Sessão de RPG** (sincronização de dados e ambiente) e **Addon de Telemetria Veicular** (agente C#/Python enviando dados de simuladores para overlay dos espectadores).
*   **Critério de Aceite:** O grupo escuta música em alta definição pelo Bot e assiste a vídeos sincronizados enquanto transmite telas; forçar o desligamento do container do bot não causa nenhuma interrupção no vídeo principal da sala.

### Fase 5: Pipeline Nativo, Replay Buffer e Polimento (Semana 8+ / Sob Demanda)
*   **Entregas:**
    *   **Replay Buffer / Clipes:** Gravação instantânea dos últimos $60\text{ segundos}$ da transmissão via botão no OSD ou atalho `Alt + F10`.
    *   *(Condicional)* **Sidecar Nativo** (C#/.NET ou Rust) via *Windows Graphics Capture API* + SDK nativo do LiveKit caso o Chromium apresente gargalo em `4K60`.
    *   Rotina automatizada de backup do banco SQLite das Salas Fixas e documentação de 1 página para migração rápida de host.