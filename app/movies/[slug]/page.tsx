import { redirect } from 'next/navigation';

export default async function MovieDetailsRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/cinema/movie/${slug}`);
}
