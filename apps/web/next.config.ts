import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  distDir:
    process.env.SRO_SYNTHETIC_HANDOVER_TESTS === '1'
      ? '.next-phase3-validation'
      : process.env.SRO_ISOLATED_BUILD === '1'
        ? '.next-onboarding-validation'
        : '.next',
  transpilePackages: [
    '@sro/types',
    '@sro/clinic-core',
    '@sro/data-access',
    '@sro/permissions',
    '@sro/validation',
    '@sro/design-tokens',
  ],
};
export default nextConfig;
