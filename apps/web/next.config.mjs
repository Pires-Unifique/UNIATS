const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

// CSP em ENFORCE: já calibrada em report-only (login + navegação sem violação).
// Se algum fluxo novo precisar de origem externa, adicione em connect-src/frame-src.
// Reverter é trivial: trocar a KEY do header p/ "Content-Security-Policy-Report-Only".
const csp = [
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
  // CSP em ENFORCE (calibrada em report-only); X-Frame-Options anti-clickjacking.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
