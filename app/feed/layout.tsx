// Navigation moved to root layout
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Moments | Nous',
  description: 'Share moments together',
};

export default function FeedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      
      <main className="pt-20 pb-24 md:ml-72 md:pt-0 md:pb-8">
        <div className="w-full max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
