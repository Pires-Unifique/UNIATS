/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@triagem/shared'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
