const hubUrl = process.env.HUB_INTERNAL_URL ?? "http://127.0.0.1:3001";
const healthUrl = new URL("/healthz", hubUrl);
const attempts = 30;
const retryIntervalMs = 500;
let lastFailure = "sem resposta";

for (let attempt = 0; attempt < attempts; attempt += 1) {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(500) });
    if (response.ok) {
      process.exit(0);
    }
    lastFailure = `HTTP ${response.status}`;
  } catch (error) {
    lastFailure = error instanceof Error ? error.message : String(error);
  }

  if (attempt < attempts - 1) {
    await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
  }
}

console.error(
  `O Hub não respondeu em ${healthUrl.href}. Inicie-o com "pnpm --filter @spectra/hub dev" ` +
  `ou use "pnpm dev" na raiz. Última falha: ${lastFailure}`,
);
process.exit(1);
