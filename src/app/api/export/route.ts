import { currentUser } from '@/lib/auth';
import { buildWorkbook } from '@/lib/export';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Выгрузка содержит договорные объёмы и себестоимость — не для анонимов.
  const user = await currentUser();
  if (!user) return new Response('Требуется вход в систему', { status: 401 });

  const wb = await buildWorkbook();
  const buffer = await wb.xlsx.writeBuffer();
  const name = `stroycontrol-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new Response(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
