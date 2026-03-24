'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/contexts/user';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrentUserAvatar } from '@/components/current-user-avatar';
import { Cake, LogOut, Mail, User2 } from 'lucide-react';
import { usePushNotifications } from '@/hooks/use-push-notifications';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export default function AccountPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { status: pushStatus, subscribe: subscribePush } = usePushNotifications();

  const previewUrl = useMemo(() => {
    if (!selectedFile) return null;
    return URL.createObjectURL(selectedFile);
  }, [selectedFile]);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const { user, isLoading: userLoading } = useUser();

  useEffect(() => {
    setIsLoading(userLoading);
    if (!userLoading) {
      if (!user) { router.push('/login'); return; }
      setEmail(user.email || '');
      setName(user.name || '');
      setBirthday(user.birthday || '');
      setAvatarUrl(user.avatarUrl || null);
    }
  }, [user, userLoading, router]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(''); setSuccess('');
    const file = event.target.files?.[0];
    if (!file) { setSelectedFile(null); return; }
    if (!file.type.startsWith('image/')) { setError('Please choose an image file'); event.target.value = ''; return; }
    if (file.size > MAX_FILE_SIZE) { setError('Image must be smaller than 5MB'); event.target.value = ''; return; }
    setSelectedFile(file);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(''); setSuccess(''); setIsSaving(true);
    try {
      let uploadedAvatarUrl = avatarUrl;
      if (selectedFile) {
        const formData = new FormData();
        formData.append('file', selectedFile);
        const uploadResponse = await fetch('/api/upload', { method: 'POST', body: formData });
        const uploadData = await uploadResponse.json();
        if (!uploadResponse.ok) throw new Error(uploadData.error || 'Failed to upload image');
        uploadedAvatarUrl = uploadData.secureUrl;
      }
      const updateResponse = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, birthday: birthday || null, avatar_url: uploadedAvatarUrl }),
      });
      const updateData = await updateResponse.json();
      if (!updateResponse.ok) throw new Error(updateData.error || 'Failed to update profile');
      setAvatarUrl(updateData.user.avatarUrl || uploadedAvatarUrl || null);
      setSelectedFile(null);
      setSuccess('Profile updated successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally { setIsSaving(false); }
  };

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', cache: 'no-store' });
    } catch { /* ignore */ }
    finally {
      window.dispatchEvent(new Event('messages:read'));
      sessionStorage.removeItem('nous:call-session');
      router.replace('/login');
      router.refresh();
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="space-y-6 md:space-y-8">
      <section className="glass-panel rounded-3xl p-5 md:p-7">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Personal space</p>
        <h1 className="mt-2 text-3xl font-serif font-semibold text-foreground md:text-4xl">Account</h1>
        <p className="mt-2 text-sm text-muted-foreground md:text-base">Manage your profile, photo, and personal details.</p>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="glass-panel rounded-3xl p-5">
          <p className="text-sm font-medium text-foreground">Profile preview</p>
          <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-border/70 bg-background/55 px-4 py-5 text-center">
            <CurrentUserAvatar size="xl" previewUrl={previewUrl} showBorder />
            <p className="max-w-full truncate text-base font-semibold text-foreground">{name || 'Your name'}</p>
            <p className="max-w-full truncate text-xs text-muted-foreground">{email || 'you@example.com'}</p>
          </div>

          {/* Logout — in sidebar on desktop */}
          <Button
            type="button"
            variant="outline"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="mt-5 w-full h-10 rounded-2xl border-border/70 text-muted-foreground hover:text-destructive hover:border-destructive/40"
          >
            <LogOut className="mr-2 h-4 w-4" />
            {isLoggingOut ? 'Logging out…' : 'Log out'}
          </Button>
        </aside>

        <Card className="glass-panel rounded-3xl border-border/70 bg-transparent shadow-none">
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
            <CardDescription>Update your photo and personal details.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <img src="/animated_heart_icon.svg" alt="Loading" className="h-6 w-6" />
                <span>Loading profile...</span>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-8">
                <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Profile photo</label>
                    <Input type="file" accept="image/*" onChange={handleFileChange} className="bg-primary/70 cursor-pointer" />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Mail className="h-4 w-4 text-primary" />
                      Email
                    </label>
                    <Input value={email} disabled className="bg-secondary" />
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <User2 className="h-4 w-4 text-primary" />
                      Name
                    </label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Cake className="h-4 w-4 text-primary" />
                      Birthday
                    </label>
                    <Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
                  </div>
                </div>

                {error && (
                  <div className="rounded-lg bg-error/10 px-4 py-3 text-sm font-medium text-error">{error}</div>
                )}
                {success && (
                  <div className="rounded-lg bg-primary/10 px-4 py-3 text-sm font-medium text-primary">{success}</div>
                )}

                <CardFooter className="px-0 flex items-center justify-center gap-4">
                  {pushStatus === 'prompt' && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={async () => { await subscribePush(); }}
                      className="h-11 rounded-2xl px-5"
                    >
                      Enable notifications
                    </Button>
                  )}
                  {pushStatus === 'subscribed' && (
                    <p className="text-sm text-primary">Notifications enabled</p>
                  )}
                  <Button type="submit" disabled={isSaving || !name.trim()} className="h-11 rounded-2xl px-5">
                    {isSaving ? 'Saving…' : 'Save changes'}
                  </Button>
                </CardFooter>
              </form>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}