/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@uniats/shared'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
