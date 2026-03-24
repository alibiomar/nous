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
      
      <main className="h-dvh overflow-hidden pt-20 pb-24 md:ml-72 md:h-screen md:pt-0 md:pb-0">
        {children}
      </main>
  );
}
