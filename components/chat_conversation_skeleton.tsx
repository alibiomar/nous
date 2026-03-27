import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ChatSkeleton() {
  return (
    <div className="flex flex-col gap-8 p-6 max-w-2xl mx-auto">
      {/* Incoming message */}
      <div className="flex items-start gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <Card className="w-full">
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      </div>

      {/* Outgoing message */}
      <div className="flex items-start gap-3 justify-end">
        <Card className="w-full max-w-md">
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-4 w-2/3 ml-auto" />
            <Skeleton className="h-4 w-1/3 ml-auto" />
          </CardContent>
        </Card>
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>

      {/* Another incoming */}
      <div className="flex items-start gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <Card className="w-full">
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      </div>

      {/* Typing indicator */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-3 rounded-full" />
        <Skeleton className="h-3 w-3 rounded-full" />
        <Skeleton className="h-3 w-3 rounded-full" />
      </div>
    </div>
  );
}
