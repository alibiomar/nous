import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
export function CinemaRoomChecking() {
  const seats = Array.from({ length: 32 });

  return (
    <div className="glass-panel rounded-3xl border border-border/70 p-8 flex flex-col items-center justify-center gap-6 text-center bg-black/60">
      {/* Screen */}
      <div className="w-full max-w-md h-24 rounded-xl bg-white/10 flex items-center justify-center border border-white/10">
        <Skeleton className="h-4 w-40 rounded-md" />
      </div>


      {/* Seats layout */}
      <div className="flex flex-col gap-2 mt-2">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex gap-2 justify-center">
            {seats.slice(row * 8, row * 8 + 8).map((_, i) => (
              <motion.div
                key={i}
                className="h-3 w-4 rounded-sm"
                initial={{ backgroundColor: "rgba(255,255,255,0.15)" }}
                animate={{
                  backgroundColor: [
                    "rgba(255,255,255,0.15)",
                    "rgba(255,255,255,0.3)",
                    "rgba(34,197,94,0.8)", // green highlight
                    "rgba(255,255,255,0.15)"
                  ]
                }}
                transition={{
                  duration: 2,
                  delay: (row * 8 + i) * 0.08,
                  repeat: Infinity,
                  repeatDelay: 1
                }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Text */}
      <p className="text-xs text-muted-foreground/80 mt-2">
        Picking the best available seat for you...
      </p>
    </div>
  );
}