import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'СтройКонтроль — учёт расхода материалов',
  description:
    'Учёт фактического расхода бетона и арматуры по захваткам, сверка с проектом и прогноз перерасхода.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
