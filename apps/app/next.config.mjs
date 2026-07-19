/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@noisebound/identity',
    '@noisebound/memory-store',
    '@noisebound/networks',
    '@noisebound/observe-loop',
    '@noisebound/pqc-wallet',
    '@noisebound/sigma-core',
  ],
};

export default nextConfig;
