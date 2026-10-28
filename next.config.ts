import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['postgres', 'exceljs', 'xlsx'],
  // Загрузка КС-6а из Excel идёт серверным действием: файл ~0,5 МБ, по умолчанию лимит 1 МБ.
  experimental: { serverActions: { bodySizeLimit: '10mb' } },
};

export default config;
