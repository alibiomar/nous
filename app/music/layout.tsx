import { Navigation } from '@/components/navigation';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Media | Nous',
  description: 'Share music and videos together',
};

export default function MediaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="md:ml-72">
        {children}
      </main>
    </div>
  );
}
