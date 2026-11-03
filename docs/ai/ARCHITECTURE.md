# Arquitetura Técnica Consolidada v2.0 (`ARCHITECTURE.md`)

> **Instrução para o Agente:** Consulte apenas a seção pertinente à sua tarefa atual.

## 1. Topologia de Mídia e WebRTC (LiveKit SFU)
- **Modelo SFU (Selective Forwarding Unit):** O streamer codifica e envia o fluxo uma única vez ao servidor LiveKit (Go), que roteia os pacotes RTP em memória sem transcodificação.
- **Simulcast, Dynacast e AdaptiveStream:**
  - Publicação em até 3 camadas (`Original` + `1080p` + `720p`) via aceleração de hardware (`NVENC`/`AMF`/`QuickSync`).
  - Se 3 camadas saturarem o encoder em `4K60` (`qualityLimitationReason === "cpu"`), o `media-client` reduz automaticamente para 2 camadas (`4K60` + `1080p60`).
  - Em monitores Ultrawide (`21:9` / `32:9`), as camadas secundárias preservam o *aspect ratio* nativo.
  - O `AdaptiveStream` solicita `720p`/`360p` no Modo Grid e barra secundária, e `Original` no Modo Foco.
- **Perfis de Captura e Codecs:**
  - **Perfil Fluidez (`contentHint: "motion"`):** Prioriza 60+ FPS constantes para jogos e simuladores.
  - **Perfil Nitidez (`contentHint: "detail"`):** Prioriza resolução nativa intacta para programação, leitura e VTT.
  - **Codecs:** `H.264` com duas camadas Simulcast como caminho universal; **Toggle `AV1` / `VP9` com SVC** só quando o SDK confirma suporte. Em screen share, o LiveKit usa `L1T3` (uma camada espacial, temporal escalável), não `L3T3`; se indisponível ou a publicação falhar, tenta `H.264`.
  - **Orçamento de publicação:** o bitrate configurado é um limite agregado entre camadas, distribuído proporcionalmente à resolução; as constraints de captura limitam resolução e FPS. Em alterações ao vivo, os limites são redistribuídos entre todos os encoders publicados.
- **Presets de Bitrate:**
  - `4K @ 60fps`: Original 35–50 Mbps | Média (1080p60) 12 Mbps | Baixa (720p60) 5 Mbps.
  - `1440p @ 60fps`: Original 20–25 Mbps | Média (1080p60) 10 Mbps | Baixa (720p60) 4 Mbps.
  - `1080p @ 60fps`: Original 12–15 Mbps | Média (720p60) 5 Mbps | Baixa (360p30) 1.5 Mbps.

## 2. Backend Hub, SQLite e Segurança (`apps/hub`)
- **Persistência SQLite (`./data/hub.db`):**
  1. `users`: `id` (UUID), `display_name`, `username_key`, `password_hash`, `recovery_code_hash`, `recovery_code_confirmed`, `secret_token_hash` (hash do token interno persistente), `created_at`.
  2. `rooms`: `id` (UUID), `slug` (Unique internal LiveKit identifier), `room_code` (Unique permanent user-facing code), `name`, `owner_user_id` (FK), `password_hash` (Nullable), `is_persistent` (Boolean), `default_layout_preset` (`'standard'` | `'rpg_theater'`), `addon_control_mode` (`'democratic'` | `'host_only'`), `created_at`, `last_active_at`.
  3. `room_permissions`: `room_id`, `user_id`, `role` (`'admin'` | `'member'`), `can_share_screen` (Boolean), `is_banned` (Boolean), `updated_at`.
  4. `room_addons`: `room_id`, `addon_id`, `is_enabled`, `config_json`.
- **Autenticação por conta:**
  - Cadastro/login por apelido exclusivo e senha (`scrypt`); cadastro confirma a senha e não exige e-mail ou confirmação por e-mail.
  - O código de recuperação tem 256 bits de entropia; o Hub armazena somente HMAC. É exibido para cópia/download, confirmado antes de liberar o app e substituído após redefinição. Se a confirmação não foi concluída, login/retomada reemite um código novo.
  - Dono e memberships definem quais salas uma conta lista. Token interno do Hub mantém autenticação das rotas atuais; não é uma senha nem um fluxo de backup apresentado ao usuário.
- **Ciclo de Vida da Sala Fixa:**
  - Metadados permanecem no SQLite. A sala no LiveKit é instanciada quando o 1º usuário entra e encerrada após **5 minutos vazia** (*grace period*).
  - O Hub gera um código permanente único de 10 caracteres e resolve-o para o identificador interno; sala privada continua exigindo senha.

## 3. Arquitetura de Interface e Cliente Desktop (`web`, `desktop`, `shared-ui`)
- **Interface `PlatformBridge`:** Abstrai enumeração/seleção de fontes no Electron, controle de janela PiP, atalhos globais e armazenamento local. O preload expõe apenas métodos IPC específicos via `contextBridge`.
- **Captura de áudio:** Web solicita áudio da janela e exclui áudio global do sistema; disponibilidade depende do navegador/OS. Desktop não publica áudio até existir captura por processo validada.
- **Player OSD e Recursos Avançados:**
  - Volume/mudo local de `0%` a `200%` via Web Audio `GainNode`, com Mixer Geral e seletor de camada por espectador.
  - Captura usa resolução/FPS máximos selecionados; publicação H.264 distribui o bitrate escolhido entre camada original e camada reduzida, mantendo o total limitado também ao atualizar ao vivo. Nitidez/fluidez preserva o `contentHint` válido para o codec ativo.
  - HUD com resolução, FPS, bitrate, codec, RTT, jitter e pacotes perdidos; conexões iniciais têm até 3 tentativas e sessões estabelecidas usam reconexão automática do LiveKit.
  - **Smart Zoom (Ultrawide Crop):** Recorte interativo no cliente para preencher telas `16:9` ao assistir streams `21:9`/`32:9`.
  - **PiP Imersivo no Electron:** Janela sem bordas, *always-on-top*, opacidade ajustável (20%–100%) e modo *click-through* (`Ctrl+Shift+P`).
  - **Gamepad UI:** Navegação completa por controle via *Gamepad API*.
  - **Rota de Escape Nativa (Fase 5 Condicional):** Sidecar em C#/.NET ou Rust usando *Windows Graphics Capture API* + NVENC direto para o LiveKit caso o Chromium apresente gargalo em 4K60.

## 4. Arquitetura do Sistema de Addons
- **Bot de Música (Spotify / YouTube Music):** Container Bot-Participante que entra na sala LiveKit e publica stream de áudio estéreo Opus `256–320 kbps`. Controlado via gaveta lateral (`sidebar`), Mini-Player no Header e sincronizado via WebSocket/Data Channel (`addon:media.music-sync`).
- **YouTube Watch Together:** Renderizado em slot `stage-grid` como um card de transmissão expansível no Showroom, sincronizado via Data Channel.
- **Telemetria Veicular & RPG Companion:** Dados enviados via Data Channels (`addon:<id>`) e renderizados em slots `overlay` (transparentes/click-through no Electron e compatíveis com Browser Source no OBS).
