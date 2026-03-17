export function proxyStream(streamUrl: string): string {
  return `/api/tuniflix/proxy?url=${encodeURIComponent(streamUrl)}`;
}