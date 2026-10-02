import type { NextConfig } from 'next';
const config: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'host.docker.internal'],
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@ligimed/config', '@ligimed/ui', '@ligimed/validation'],
};
export default config;
