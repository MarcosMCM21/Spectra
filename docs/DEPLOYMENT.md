# Testes locais e deploy em produção

Este guia cobre o cliente Web e o Hub do Spectra no computador local e em um
servidor Linux/CasaOS. O deploy de produção usa:

- **Caddy e LiveKit em containers Docker com rede host**;
- **Hub Node.js executado no host pelo systemd**;
- **Frontend Web compilado** e servido como arquivos estáticos pelo Caddy;
- **SQLite persistente** em `apps/hub/data`.

O Caddy encaminha `/api` e `/healthz` ao Hub local e encaminha a sinalização
LiveKit ao serviço LiveKit local. Não é necessário manter um PC de
desenvolvimento ligado nem servir a Web com Vite em produção.

## 1. Testes locais

### Requisitos

- Node.js `>=22.12.0`;
- pnpm `12.15.0` (versão indicada no `package.json`);
- Windows, macOS ou Linux para os testes/builds comuns.

O Docker é opcional para compilar e executar os testes automatizados. É
necessário ter um LiveKit acessível para validar a entrada em salas e mídia de
ponta a ponta.

### Instalar, testar e compilar

Na raiz do repositório:

```bash
pnpm install --frozen-lockfile
pnpm validate:arch
pnpm typecheck
pnpm test
pnpm build
```

O build gera `dist/` em cada pacote e `apps/web/dist/` para a interface Web.
Esses diretórios são gerados novamente pelos comandos e não devem ser
versionados.

### Executar Hub e Web em desenvolvimento

O Hub e a Web podem ser iniciados em terminais separados. A Web espera o
endpoint de saúde do Hub antes de abrir o Vite.

Terminal 1:

```bash
pnpm --filter @spectra/hub dev
```

Terminal 2:

```bash
pnpm --filter @spectra/web dev
```

Abra `http://localhost:5173`. O Hub fica em `http://localhost:3001`; valide sua
saúde com:

```bash
curl http://localhost:3001/healthz
```

No PowerShell, pode-se usar:

```powershell
Invoke-RestMethod http://localhost:3001/healthz
```

Para iniciar todos os pacotes de desenvolvimento, incluindo o Desktop
(Electron), use `pnpm dev` em vez dos dois comandos acima.

### Configuração local do Hub

O Hub em desenvolvimento lê `deploy/.env.local`, separado do arquivo de
produção `deploy/.env`. Crie o arquivo local com os valores abaixo; ele é
ignorado pelo Git:

```dotenv
NODE_ENV=development
HUB_HOST=127.0.0.1
HUB_PORT=3001
HUB_DB_PATH=./data/dev.sqlite
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_INTERNAL_URL=http://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecretdevsecretdevsecret123456
```

Se não tiver um LiveKit local, o Hub ainda pode iniciar com os defaults, mas
as operações de sala que chamam o LiveKit não funcionarão. Esses valores são
somente para desenvolvimento. Não copie `deploy/.env` de produção para o
computador local nem use credenciais locais no servidor.

## 2. Preparar o servidor

Os comandos abaixo assumem um servidor Linux/CasaOS, acesso administrativo e
um clone em `/opt/spectra`. Se escolher outro diretório, adapte todos os
caminhos do exemplo de serviço systemd.

### Rede, domínio e portas

1. Aponte o domínio DuckDNS para o IP público do servidor e configure o token
   DuckDNS.
2. No roteador e no firewall do servidor, permita/encaminhe:
   - TCP e UDP `8443` para HTTPS/WebSocket do Caddy;
   - TCP `7881` para fallback LiveKit via TCP;
   - UDP `7882` para mídia LiveKit.
3. **Não exponha publicamente a porta TCP `7880`**. Caddy e Hub acessam o
   LiveKit localmente pela rede host.
4. Confirme que nenhuma outra aplicação ocupa essas portas.

O projeto configura HTTPS em `8443`; se alterar essa porta, atualize também
`CADDY_HTTPS_PORT`, o endereço `LIVEKIT_URL` e as regras do firewall/roteador.

### Clonar e instalar dependências

Instale Node.js `>=22.12.0`, pnpm `12.15.0`, Git e Docker Compose no servidor.
Depois:

```bash
sudo mkdir -p /opt/spectra
sudo chown "$USER":"$USER" /opt/spectra
git clone <URL_DO_REPOSITORIO> /opt/spectra
cd /opt/spectra
pnpm install --frozen-lockfile
```

Rode a instalação no próprio servidor Linux. Não copie `node_modules` do
Windows: o Hub usa `better-sqlite3`, que inclui um módulo nativo dependente do
sistema e da arquitetura.

### Configurar segredos e endereços

Crie o arquivo de ambiente sem substituir um arquivo que já exista:

```bash
cp -n deploy/.env.example deploy/.env
nano deploy/.env
```

Configure pelo menos:

| Variável | Valor |
|---|---|
| `DOMAIN` | Domínio DuckDNS real, sem `https://` |
| `DUCKDNS_TOKEN` | Token atual do DuckDNS |
| `CADDY_HTTPS_PORT` | `8443`, salvo se a porta foi alterada |
| `LIVEKIT_URL` | `wss://<seu-dominio>:8443` |
| `LIVEKIT_API_KEY` | Chave aleatória própria |
| `LIVEKIT_API_SECRET` | Segredo aleatório forte, diferente do exemplo |
| `NODE_ENV` | `production` |
| `HUB_HOST` | `127.0.0.1` |
| `HUB_PORT` | `3001` |
| `HUB_DB_PATH` | `./data/hub.sqlite` |

O par `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` deve ser o mesmo para o Hub e
LiveKit. Gere um segredo novo no servidor, por exemplo com
`openssl rand -hex 32`; não reutilize os valores de exemplo nem qualquer
credencial de uma exportação CasaOS antiga.

Proteja o arquivo e crie o diretório do banco:

```bash
chmod 600 deploy/.env
sudo chown SEU_USUARIO:SEU_USUARIO deploy/.env
mkdir -p apps/hub/data
```

`HUB_DB_PATH` é relativo ao diretório de trabalho do Hub (`apps/hub` no
serviço abaixo), portanto o banco fica em `apps/hub/data/hub.sqlite`. Mantenha
esse diretório persistente entre atualizações e faça backup antes de atualizar
o servidor. Use no `chown` o mesmo usuário configurado em `User=` no serviço
systemd, e permita que esse usuário escreva em `apps/hub/data`.

### Verificar antes de iniciar os serviços

```bash
set -e
node --version
pnpm --version
pnpm validate:arch
pnpm typecheck
pnpm test
pnpm build
docker compose --env-file deploy/.env -f deploy/docker-compose.yml config
```

O último comando valida a configuração resolvida do Docker Compose. Não
publique o resultado se ele incluir valores secretos.

O comando deve incluir o subcomando `config` e o caminho do arquivo
`-f deploy/docker-compose.yml`; rodar apenas `docker compose
--env-file deploy/.env` mostra a ajuda do Docker, não valida o deploy. `set -e`
faz a sequência parar imediatamente no primeiro comando com erro.

Se `pnpm validate:arch` disser que não encontra arquivos em `.cline`, atualize
o clone para a versão do repositório que inclui o validador independente em
`scripts/validate-architecture.mjs`. `.cline` e `.clinerules` são diretórios
locais ignorados pelo Git e não devem ser pré-requisitos para publicar o
aplicativo.

## 3. Iniciar em produção

### Iniciar o Hub automaticamente com systemd

Crie `/etc/systemd/system/spectra-hub.service`. Substitua `/usr/bin/node` pelo
caminho retornado por `command -v node`, se for diferente:

```ini
[Unit]
Description=Spectra Hub
After=network.target

[Service]
Type=simple
User=SEU_USUARIO
WorkingDirectory=/opt/spectra/apps/hub
ExecStart=/usr/bin/node --env-file=/opt/spectra/deploy/.env dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Use um usuário Linux não-root que tenha permissão de leitura no projeto e de
escrita em `apps/hub/data`. Ative e confira o serviço:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now spectra-hub
sudo systemctl status spectra-hub
curl http://127.0.0.1:3001/healthz
```

Se o Node foi instalado via `nvm`, o caminho de `node` pode estar dentro do
diretório pessoal do usuário. Use esse caminho absoluto em `ExecStart`; o
systemd não carrega automaticamente o ambiente interativo do shell.

### Iniciar Caddy e LiveKit

Depois que `pnpm build` criar `apps/web/dist/` e o Hub estiver escutando:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs --tail=100 caddy livekit
```

O Compose usa `network_mode: host`, como no servidor CasaOS: as portas são
abertas diretamente no host e não se declaram mapeamentos `ports:` no Compose.
O Caddy serve `apps/web/dist/`, encaminha `/api` e `/healthz` para o Hub em
`127.0.0.1:3001` e encaminha `/rtc*` e `/twirp*` para o LiveKit em
`127.0.0.1:7880`.

Valide pelo servidor e a partir de uma rede externa:

```bash
curl http://127.0.0.1:3001/healthz
curl -I https://<seu-dominio>:8443/
curl -I https://<seu-dominio>:8443/healthz
```

O primeiro teste é local no host. Os demais verificam TLS, Web e o caminho de
proxy do Hub. A página inicial deve retornar `HTTP/1.1 200 OK` com
`Content-Type: text/html`; o `/healthz` deve retornar `200 OK` e JSON.
Para abrir a Web, acesse `https://<seu-dominio>:8443/` em um navegador, por
exemplo `https://optimus-stream.duckdns.org:8443/`.

Se `/healthz` responde, mas `/` retorna `404`, o Caddy está alcançável e o
proxy para o Hub está funcionando; o problema está especificamente nos
arquivos estáticos da Web (build ausente, volume não montado ou container
iniciado por uma configuração CasaOS antiga). No servidor, execute na raiz do
clone:

```bash
cd /DATA/AppData/spectra
test -s apps/web/dist/index.html && echo "Web build encontrada" || echo "Web build ausente"
docker inspect caddy --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
docker exec caddy ls -la /srv/spectra/web
```

O `docker inspect` deve mostrar `.../apps/web/dist -> /srv/spectra/web`, e o
`ls` no container deve mostrar `index.html` e `assets/`. Se a build estiver
ausente, gere-a e recrie o Caddy usando o Compose do clone:

```bash
pnpm build
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --force-recreate caddy
```

Se o bind mount exibido por `docker inspect` não apontar para
`/DATA/AppData/spectra/apps/web/dist`, o Caddy está sendo executado por outro
Compose ou pela definição antiga do CasaOS. Suba/recrie-o pelo comando acima
e confira os logs:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs --tail=100 caddy
```

Faça também um teste real entrando em uma sala e compartilhando tela; compilar
e receber HTTP 200 não validam a conectividade UDP do LiveKit.

## 4. Atualizar uma instalação existente

Antes de atualizar, faça backup do SQLite e confirme que `deploy/.env` está
preservado. A partir da raiz do clone:

```bash
sudo systemctl stop spectra-hub
cp apps/hub/data/hub.sqlite "apps/hub/data/hub.sqlite.backup-$(date +%Y%m%d-%H%M%S)"
git pull --ff-only
pnpm install --frozen-lockfile
pnpm test
pnpm build
sudo systemctl start spectra-hub
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d
```

Confira `sudo journalctl -u spectra-hub -n 100 --no-pager` e os logs dos
containers após a atualização.

## 5. Segurança e operação

- Nunca versione `deploy/.env`, banco SQLite, chaves ou tokens. O
  `deploy/.env.example` contém apenas placeholders.
- Se um token ou segredo foi exposto, revogue-o e gere outro antes de abrir o
  serviço ao público.
- Faça backup periódico de `apps/hub/data/hub.sqlite`. Para um backup simples
  e consistente, pare o Hub, copie o banco e inicie-o novamente.
- Mantenha Node, pnpm, imagens Docker e sistema operacional atualizados.
- A configuração de produção atual não inicia o Desktop nem Addons; eles não
  fazem parte dos serviços deste Compose.
- A build de produção da Web é servida pelo Caddy. Não use `pnpm dev` nem
  `vite preview` como serviço público permanente.
