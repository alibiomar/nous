// lib/proxy-stream.ts
export function proxyStream(streamUrl: string, embedReferer?: string): string {
  const base = `/api/tuniflix/proxy?url=${encodeURIComponent(streamUrl)}`;
  return embedReferer ? `${base}&referer=${encodeURIComponent(embedReferer)}` : base;
}