import { Navigation } from '@/components/navigation';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Feed | Nous',
  description: 'Share moments together',
};

export default function FeedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      {/* Main content with responsive margins and improved spacing */}
      <main className="md:ml-72 transition-all duration-300 pt-16 pb-20 md:pt-0 md:pb-0">
        <div className="w-full max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
