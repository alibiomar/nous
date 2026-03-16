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
      <main className="h-[calc(100dvh-9rem)] pt-20 pb-24 md:ml-72 md:h-screen md:pt-0 md:pb-0">
        {children}
      </main>
    </div>
  );
}
