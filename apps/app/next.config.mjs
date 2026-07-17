/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@noisebound/identity',
    '@noisebound/networks',
    '@noisebound/pqc-wallet',
    '@noisebound/sigma-core',
  ],
};

export default nextConfig;
