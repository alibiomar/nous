import { Navigation } from '@/components/navigation';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Messages | Nous',
  description: 'Talk with your special someone',
};

export default function MessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      {/* Full height layout for chat */}
      <main className="md:ml-72 transition-all duration-300 pt-16 pb-20 md:pt-0 md:pb-0   md:h-screen">
        {children}
      </main>
    </div>
  );
}
