import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['postgres', 'exceljs'],
};

export default config;
