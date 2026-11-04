/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@bloodhound/core', '@bloodhound/engine'],
  serverExternalPackages: ['@prisma/client', 'prisma'],
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default nextConfig;
