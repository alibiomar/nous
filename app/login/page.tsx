'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center">
              <span className="font-serif text-xl font-bold text-white">N</span>
            </div>
          </div>
          <h1 className="font-serif text-3xl font-semibold text-foreground mb-2">Nous</h1>
          <p className="text-text-secondary text-sm">A private space for two</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Email
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              disabled={isLoading}
              className="bg-secondary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Password
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              disabled={isLoading}
              className="bg-secondary"
            />
          </div>

          {error && (
            <div className="p-3 bg-error/10 text-error text-sm rounded-lg font-medium">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={isLoading || !email || !password}
            size="lg"
            className="w-full"
          >
            {isLoading ? 'Logging in...' : 'Log In'}
          </Button>
        </form>
      </div>
    </div>
  );
}
