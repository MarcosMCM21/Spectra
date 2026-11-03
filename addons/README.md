# Addons oficiais do Spectra

Diretório reservado aos addons da Fase 4 (`music-bot`, `youtube-stage`,
`soundpad`, `sim-telemetry`, `rpg-companion`, `replay-buffer`). Cada addon é um
pacote do workspace (`addons/*`) que depende de `@spectra/addon-sdk` e
`@spectra/contracts`, com `manifest.json` validado por Zod, UI montada em
`<iframe sandbox="allow-scripts">` e Data Channels prefixados com `addon:<id>`.

Nenhum addon foi implementado ainda (Fase 1 = apenas esqueleto do monorepo).
