#!/usr/bin/env node
/**
 * Wrapper fino (camada de compatibilidade de caminhos).
 * A lógica real de sincronização/higienização do ambiente Cline vive em
 * ".cline/scripts/sync-cline-workspace.mjs". Este arquivo apenas delega a execução.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const target = path.join(root, '.cline', 'scripts', 'sync-cline-workspace.mjs');

const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
});

if (result.error) {
  console.error(`[Wrapper] Falha ao executar "${target}": ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 0);
