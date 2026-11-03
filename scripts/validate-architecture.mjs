#!/usr/bin/env node
/**
 * Wrapper fino (camada de compatibilidade de caminhos).
 * A lógica real de validação arquitetural vive em ".cline/scripts/validate-architecture.mjs".
 * Este arquivo apenas delega a execução para lá, mantendo a interface pública
 * "node scripts/validate-architecture.mjs" exigida por AGENTS.md e /verify-and-test.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const target = path.join(root, '.cline', 'scripts', 'validate-architecture.mjs');

const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
});

if (result.error) {
  console.error(`[Wrapper] Falha ao executar "${target}": ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 0);
