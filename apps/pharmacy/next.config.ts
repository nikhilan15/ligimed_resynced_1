import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnvironment = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvironment)) process.loadEnvFile(rootEnvironment);

const config: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'host.docker.internal'],
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@ligimed/config', '@ligimed/ui', '@ligimed/validation'],
  headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default config;
