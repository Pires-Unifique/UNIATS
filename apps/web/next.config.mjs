const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

// CSP em REPORT-ONLY: o navegador só REPORTA violações (no console do DevTools),
// NÃO bloqueia nada. Serve pra calibrar as diretivas com o MSAL/Graph ligados
// antes de virar enforce. Ajuste `connect-src`/`frame-src` conforme os relatos.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${apiBase} https://login.microsoftonline.com https://graph.microsoft.com`.replace(
    /\s+/g,
    ' ',
  ),
  "frame-src 'self' https://login.microsoftonline.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://login.microsoftonline.com",
  "object-src 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@uniats/shared'],
  experimental: {
    typedRoutes: true,
    // SÓ NO WINDOWS (dev): geração estática com 1 worker. O EDR corporativo
    // derruba os workers paralelos do `next build` com 0xC0000409 (ponto do
    // crash varia a cada rodada — corrida na injeção de processo). Em Linux
    // (CI/Docker) nada muda.
    ...(process.platform === 'win32' ? { cpus: 1, workerThreads: false } : {}),
  },
  // Cabeçalhos de segurança (defesa em profundidade). SEM HSTS (TLS fica no proxy).
  // A CSP entra em REPORT-ONLY (não bloqueia) pra calibrar sem quebrar o MSAL;
  // X-Frame-Options protege contra clickjacking do app.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy-Report-Only', value: cspReportOnly },
        ],
      },
    ];
  },
};

export default nextConfig;
