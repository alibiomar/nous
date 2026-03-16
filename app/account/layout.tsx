import { Navigation } from '@/components/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Account | Nous',
  description: 'Manage your profile',
};

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      {/* Main content with responsive margins and improved spacing */}
      <main className="md:ml-72 transition-all duration-300 pt-16 pb-20 md:pt-0 md:pb-0">
        <div className="w-full max-w-2xl mx-auto px-4 md:px-6 py-6 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
