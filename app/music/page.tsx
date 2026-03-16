export default function MediaPage() {
  return (
    // The visual content for this route is completely managed by the <GlobalMediaPlayer /> 
    // located in app/layout.tsx which overlays this space when the route is /music.
    // We render an empty div here just to satisfy the Next.js page requirement.
    <div className="w-full h-full" />
  );
}
