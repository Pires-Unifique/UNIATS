import { ReactNode } from 'react';

import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { AuthGuard } from '@/lib/auth';

export default function AuthedLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
