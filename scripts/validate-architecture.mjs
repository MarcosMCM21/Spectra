#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'AGENTS.md',
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  'docs/ai/ACTIVE_CONTEXT.md',
  'docs/ai/PROJECT_MAP.md',
  'docs/ai/ARCHITECTURE.md',
  'docs/ai/DECISIONS.md',
  'docs/ai/PROGRESS.md',
  'deploy/docker-compose.yml',
  'deploy/Caddyfile',
  'deploy/livekit.yaml',
  'deploy/.env.example',
];

const errors = [];

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    errors.push(`Arquivo obrigatório ausente: ${relativePath}`);
  }
}

function findSourceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findSourceFiles(entryPath);
    return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ? [entryPath] : [];
  });
}

const forbiddenImports = [
  { packageName: 'electron', pattern: /from\s*['"]electron['"]|require\(\s*['"]electron['"]\s*\)/ },
  { packageName: 'livekit-client', pattern: /from\s*['"]livekit-client['"]|require\(\s*['"]livekit-client['"]\s*\)/ },
];

for (const filePath of findSourceFiles(path.join(root, 'packages/shared-ui/src'))) {
  const contents = fs.readFileSync(filePath, 'utf8');
  for (const { packageName, pattern } of forbiddenImports) {
    if (pattern.test(contents)) {
      errors.push(
        `${path.relative(root, filePath)} importa ${packageName}, proibido em packages/shared-ui`,
      );
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[ERRO] ${error}`);
  console.error(`=== Resultado: ${errors.length} erro(s) ===`);
  process.exitCode = 1;
} else {
  console.log('=== Validando arquivos do projeto e fronteira shared-ui ===');
  console.log('=== Resultado: 0 erro(s) ===');
}
