'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrentUserAvatar } from '@/components/current-user-avatar';

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
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const previewUrl = useMemo(() => {
    if (!selectedFile) return null;
    return URL.createObjectURL(selectedFile);
  }, [selectedFile]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    const loadProfile = async () => {
      setIsLoading(true);
      try {
        const response = await fetch('/api/auth/profile');
        if (response.status === 401) {
          router.push('/login');
          return;
        }

        const data = await response.json();
        if (!response.ok) {
          setError(data.error || 'Failed to load profile');
          return;
        }

        setEmail(data.user.email || '');
        setName(data.user.name || '');
        setBirthday(data.user.birthday || '');
        setAvatarUrl(data.user.avatarUrl || null);
      } catch (err) {
        setError('Failed to load profile');
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [router]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    setSuccess('');

    const file = event.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file');
      event.target.value = '';
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError('Image must be smaller than 5MB');
      event.target.value = '';
      return;
    }

    setSelectedFile(file);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setIsSaving(true);

    try {
      let uploadedAvatarUrl = avatarUrl;

      if (selectedFile) {
        const formData = new FormData();
        formData.append('file', selectedFile);

        const uploadResponse = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        const uploadData = await uploadResponse.json();
        if (!uploadResponse.ok) {
          throw new Error(uploadData.error || 'Failed to upload image');
        }

        uploadedAvatarUrl = uploadData.secureUrl;
      }

      const updateResponse = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          birthday: birthday || null,
          avatar_url: uploadedAvatarUrl,
        }),
      });

      const updateData = await updateResponse.json();
      if (!updateResponse.ok) {
        throw new Error(updateData.error || 'Failed to update profile');
      }

      setAvatarUrl(updateData.user.avatarUrl || uploadedAvatarUrl || null);
      setSelectedFile(null);
      setSuccess('Profile updated successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="pb-4 border-b border-border">
        <h1 className="text-3xl font-serif font-semibold text-foreground">Account</h1>
        <p className="text-sm text-muted-foreground mt-2">Manage your profile and settings</p>
      </div>

      {/* Account Form Card */}
      <Card>
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
          <CardDescription>Update your photo and personal details.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading profile...</div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                <CurrentUserAvatar 
                  size="xl"
                  previewUrl={previewUrl}
                  showBorder
                />
                <div className="flex-1 space-y-2">
                  <label className="text-sm font-medium text-foreground">Profile photo</label>
                  <Input type="file" accept="image/*" onChange={handleFileChange} />
                  <p className="text-xs text-muted-foreground">PNG or JPG up to 5MB.</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Email</label>
                  <Input value={email} disabled className="bg-secondary" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Name</label>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Your name"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Birthday</label>
                  <Input
                    type="date"
                    value={birthday}
                    onChange={(event) => setBirthday(event.target.value)}
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-error/10 px-4 py-3 text-sm font-medium text-error">
                  {error}
                </div>
              )}

              {success && (
                <div className="rounded-lg bg-primary/10 px-4 py-3 text-sm font-medium text-primary">
                  {success}
                </div>
              )}

              <CardFooter className="px-0">
                <Button type="submit" disabled={isSaving || !name.trim()}>
                  {isSaving ? 'Saving...' : 'Save changes'}
                </Button>
              </CardFooter>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
