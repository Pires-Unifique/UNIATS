/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@uniats/shared'],
  experimental: {
    typedRoutes: true,
  },
  // Cabeçalhos de segurança (defesa em profundidade). SEM HSTS (TLS fica no proxy)
  // e SEM CSP estrita por ora — CSP quebraria o MSAL e será calibrada num teste
  // dedicado. X-Frame-Options protege contra clickjacking do app.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
