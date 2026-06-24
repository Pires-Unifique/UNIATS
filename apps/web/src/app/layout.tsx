import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { ThemeProvider, themeInitScript } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'Collab — Unifique',
  description: 'Plataforma de triagem e análise de entrevistas',
  robots: { index: false, follow: false }, // app interno
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Define o tema antes da hidratação para evitar flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
