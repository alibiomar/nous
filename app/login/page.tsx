'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/contexts/user';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Card } from '@/components/ui/card';
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { user, isLoading: userLoading } = useUser();

  useEffect(() => {
    if (!userLoading && user) router.replace('/feed');
  }, [user, userLoading, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Login failed');
        setIsLoading(false);
        return;
      }

      // Login successful - redirect to feed
      setIsLoading(false);
      router.push('/feed');
    } catch (err) {
      setError('An error occurred. Please try again.');
      setIsLoading(false);
    }
  };



  return (
    <div className="min-h-dvh">
      <div className="grid min-h-dvh grid-cols-1 md:grid-cols-2">
        <section className="relative flex items-center justify-center px-6 py-14 md:px-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(242,193,165,0.32),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(58,54,45,0.12),transparent_42%)]" />
          <div className="relative z-10 flex flex-col items-center text-center">
          <div className="relative h-28 md:h-40 w-auto">
<img src="/logo.svg" className="dark:hidden h-28 w-auto md:h-40"  alt="Nous logo"
/>
<img src="/logoDark.svg" className="hidden dark:block h-28 w-auto md:h-40"   alt="Nous logo"
/>

</div>   
          <p className="mt-3 max-w-sm text-sm text-muted-foreground md:text-base">A private space for two</p>
          </div>
        </section>

<section
  className="flex items-center justify-center px-6 py-10 md:px-10 bg-primary dark:bg-primary/20"
>
          <Card className=" glass-panel w-full bg-background/10 max-w-md rounded-3xl border border-border/70 p-7 shadow-[0_20px_55px_rgba(58,54,45,0.22)] backdrop-blur md:p-9">

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  Email
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  disabled={isLoading}
                  className="border-border/70"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">
                  Password
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  disabled={isLoading}
                  className="border-border/70"
                />
              </div>

              {error && (
                <div className="rounded-lg bg-error/10 p-3 text-sm font-medium text-error">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={isLoading || !email || !password}
                size="lg"
                className="mt-2 h-11 w-full rounded-xl"
              >
                {isLoading ? 'Logging in...' : 'Log In'}
              </Button>
            </form>
          </Card>
        </section>
      </div>
    </div>
  );
}
