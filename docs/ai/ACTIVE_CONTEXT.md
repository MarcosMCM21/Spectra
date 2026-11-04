# Contexto Ativo da IA (`ACTIVE_CONTEXT.md`)

> **Instrução para o Agente:** Este é o ponto de partida obrigatório de toda sessão. Mantenha este arquivo enxuto (máx. 60 linhas) e atualize-o ao concluir cada tarefa via `/complete-task`.

## 1. Status Atual do Projeto
- **Fase atual:** Fase 2 — OSD, Smart Zoom, codecs eficientes e resiliência.
- **Dev local:** Hub usa Node watch restrito ao `apps/hub/src`; o Vite aguarda `/healthz` do Hub antes de iniciar, evitando chamadas `/api` durante a janela em que o backend ainda não aceita conexões.
- **Entrega recente:** Core de screen share revisado: resolução/FPS selecionados são tetos reais, bitrate H.264 é agregado entre camadas (inclusive nas mudanças ao vivo), AV1/VP9 usam checagem de suporte do LiveKit e screen share SVC usa L1T3. Fase 2 também inclui OSD/mixer, seleção de camada, Smart Zoom, HUD e reconexão do LiveKit.
- **Convites de sala:** Hub gera código permanente único de 10 caracteres; criação não pede slug, links e busca usam o código. Migração atribui códigos às salas existentes sem alterar seus identificadores internos; sala privada continua pedindo senha.
- **Recuperação da conta:** Cadastro pede confirmação de senha; código de recuperação de 256 bits pode ser copiado ou baixado e é obrigatório confirmar que foi guardado. Hub persiste somente HMAC; tela “Esqueci minha senha” redefine a senha e emite um código substituto.
- **Captura:** Web usa o seletor nativo do Chrome/Edge, solicita áudio da janela/aba (`windowAudio`) e descarta áudio de monitor/origem desconhecida. Desktop lista fontes via IPC e mostra miniaturas 16:9 com monitor/resolução ou descrição da janela. Áudio por aplicativo no Desktop continua pendente: Electron oferece loopback global, que é proibido como fallback.
- **Deploy/documentação:** `docs/DEPLOYMENT.md` cobre testes locais, build e deploy Linux/CasaOS; Caddy serve `apps/web/dist`, encaminha Hub/LiveKit por loopback, e Hub pode ser iniciado via systemd. Desenvolvimento do Hub usa `deploy/.env.local`; export CasaOS redundante removido.
- **Diagnóstico servidor:** `/healthz` público responde 200 via Caddy, mas `/` responde 404; guia agora explica como verificar build/mount `/srv/spectra/web`, recriar o Caddy pelo Compose do clone e abrir a URL pública na porta 8443.
- **Correções pós-log do servidor:** validador não depende mais de `.cline` ignorado; Hub declara `zod` diretamente; pnpm autoriza o instalador do electron-winstaller. Comando de validação Docker documentado com `-f ... config`.
- **Validação:** instalação congelada, typecheck (10/10), build forçado (7/7), testes (14 tarefas) e validador passaram localmente. Compose alinhado ao CasaOS (Caddy/LiveKit em host network); YAMLs parseados e `LIVEKIT_KEYS` corrigido. Credenciais do servidor devem ser rotacionadas. LiveKit real, captura 4K/60, comportamento de encoder e rede limitada continuam pendentes.
- **Arquivos principais:** `apps/web/src/main.tsx`, `apps/web/src/styles.css`, `apps/desktop/src/index.ts`, `apps/desktop/src/preload.cts`, `packages/media-client/src/session.ts`, `apps/hub/src/services/accounts.ts` e `apps/hub/src/services/rooms.ts`.
- **Desktop:** `pnpm --filter @spectra/desktop package:win` gera instalador NSIS e ZIP com a Web compilada em `resources/web`; pode apontar para Hub remoto via `SPECTRA_HUB_URL` no ambiente de execução ou `VITE_HUB_URL` no build. `SPECTRA_WEB_URL` continua como override; em desenvolvimento, o padrão é `http://localhost:5173`.

## 2. Próximos Passos
1. Validar Fase 2 em LiveKit real e rede limitada (camadas/6 Mbps), encoder AV1/VP9, limites agregados e retomada após queda.
2. Implementar captura nativa de áudio isolada por processo no Windows antes de habilitar o controle no Desktop; nunca usar loopback global como fallback.
3. Rotacionar credenciais expostas na exportação, aplicar o deploy documentado e validar Caddy/LiveKit/UDP 7882 no servidor.
4. Completar recursos futuros do documento mestre: PiP e Addons.
5. Testar o instalador e ZIP em uma instalação limpa do Windows, incluindo configuração do Hub remoto.

## 3. Regras Críticas
- **Voz:** Nunca implementar captura de microfone, VoIP, mute/deafen ou detecção de fala. Áudio da transmissão deve ser somente da janela/aplicativo escolhido; Addons podem publicar suas próprias faixas.
- **Salas fixas:** Permanecem no SQLite; sessões LiveKit são sob demanda, com grace period de 300 s quando vazias.
- **Identidade:** Conta por apelido/senha; token persistente interno vincula rotas do Hub e permissões de salas.
- **Áudio:** Sem microfone; jamais apresentar loopback global como captura isolada de uma janela.
- **Desacoplamento:** `packages/shared-ui` não importa `electron` nem `livekit-client`; acesso à plataforma via `PlatformBridge` e abstrações.
- **Entry points:** Pacotes executáveis/library expõem `./dist/index.js` quando sua fonte é `src/index.ts` (DEC-16).
