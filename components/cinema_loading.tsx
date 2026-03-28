import { motion } from "framer-motion";
import { useEffect } from "react";

function CurtainPanel({ side }: { side: "left" | "right" }) {
  const isLeft = side === "left";
  const foldCount = 7;

  return (
    <motion.div
      className="relative w-1/2 h-full overflow-hidden"
      style={{ transformOrigin: isLeft ? "left center" : "right center" }}
      initial={{ x: 0, scaleX: 1 }}
      animate={{ x: isLeft ? "-100%" : "100%", scaleX: 0.92 }}
      transition={{
        duration: 2.4,
        ease: [0.76, 0, 0.24, 1],
        delay: 0.4,
      }}
    >
      {/* Base curtain fabric — espresso/walnut from Nous dark palette */}
      <div
        className="absolute inset-0"
        style={{
          background: isLeft
            ? `linear-gradient(to right,
                #100c08 0%, #1a1610 6%, #242018 12%, #302a20 18%,
                #242018 24%, #1e1a12 30%, #100c08 36%, #1a1610 42%,
                #242018 48%, #302a20 54%, #242018 60%, #1e1a12 66%,
                #100c08 72%, #1a1610 78%, #242018 84%, #100c08 100%)`
            : `linear-gradient(to left,
                #100c08 0%, #1a1610 6%, #242018 12%, #302a20 18%,
                #242018 24%, #1e1a12 30%, #100c08 36%, #1a1610 42%,
                #242018 48%, #302a20 54%, #242018 60%, #1e1a12 66%,
                #100c08 72%, #1a1610 78%, #242018 84%, #100c08 100%)`,
        }}
      />

      {/* Vertical fold shadows — pleats with apricot highlight catch */}
      {Array.from({ length: foldCount }).map((_, i) => {
        const pct = (i / (foldCount - 1)) * 100;
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0"
            style={{
              left: `${pct}%`,
              width: "14.28%",
              background: isLeft
                ? `linear-gradient(to right,
                    rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.12) 30%,
                    rgba(240,185,152,0.055) 55%, rgba(0,0,0,0.35) 100%)`
                : `linear-gradient(to left,
                    rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.12) 30%,
                    rgba(240,185,152,0.055) 55%, rgba(0,0,0,0.35) 100%)`,
            }}
          />
        );
      })}

      {/* Fabric texture overlay */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundSize: "150px 150px",
          mixBlendMode: "overlay",
        }}
      />

      {/* Animated shimmer sweep — warm apricot at opening edge */}
      <motion.div
        className="absolute top-0 bottom-0 w-24 pointer-events-none"
        style={{
          [isLeft ? "right" : "left"]: 0,
          background: isLeft
            ? "linear-gradient(to left, rgba(240,185,152,0.15) 0%, rgba(240,160,100,0.04) 60%, transparent 100%)"
            : "linear-gradient(to right, rgba(240,185,152,0.15) 0%, rgba(240,160,100,0.04) 60%, transparent 100%)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0.6] }}
        transition={{ delay: 0.6, duration: 1.8, ease: "easeOut" }}
      />

      {/* Curtain rod rings */}
      <div className="absolute top-0 left-0 right-0 flex justify-around px-2 pt-1 z-10">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-full border border-gray-400/70"
            style={{
              width: 10,
              height: 14,
              background: "radial-gradient(circle at 35% 35%, #d0d0d0 , #707070 )",
              boxShadow: "0 1px 3px rgba(0,0,0,0.6)",
            }}
          />
        ))}
      </div>

      {/* Bottom gather / puddle — deep espresso */}
      <div
        className="absolute bottom-0 left-0 right-0 h-16"
        style={{
          background: isLeft
            ? `linear-gradient(to right,
                rgba(8,6,3,0.97) 0%, rgba(28,22,14,0.72) 20%,
                rgba(14,11,6,0.85) 40%, rgba(32,26,16,0.65) 60%,
                rgba(18,14,8,0.9) 80%, rgba(6,4,2,0.98) 100%)`
            : `linear-gradient(to left,
                rgba(8,6,3,0.97) 0%, rgba(28,22,14,0.72) 20%,
                rgba(14,11,6,0.85) 40%, rgba(32,26,16,0.65) 60%,
                rgba(18,14,8,0.9) 80%, rgba(6,4,2,0.98) 100%)`,
          filter: "blur(1px)",
        }}
      />
    </motion.div>
  );
}

function CurtainRod() {
  return (
    <div className="absolute top-0 left-0 right-0 z-20" style={{ height: 18 }}>
      <div
        className="w-full h-full"
        style={{
          background:
            "linear-gradient(to bottom, #e8e8e8 0%, #a0a0a0 40%, #6e6e6e 70%, #c0c0c0 100%)",
          boxShadow:
            "0 3px 12px rgba(0,0,0,0.8), inset 0 1px 1px rgba(255,255,255,0.5)",
        }}
      />
      {(["left", "right"] as const).map((pos) => (
        <div
          key={pos}
          className="absolute top-0 w-5 h-full rounded-full"
          style={{
            [pos]: 0,
            background: "radial-gradient(circle at 40% 40%, #f0f0f0, #707070)",
            boxShadow: "0 2px 6px rgba(0,0,0,0.7)",
          }}
        />
      ))}
    </div>
  );
}

function StageLight() {
  return (
    <motion.div
      className="absolute inset-0 pointer-events-none z-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.4, duration: 1.2, ease: "easeOut" }}
      style={{
        background:
          "radial-gradient(ellipse 45% 60% at 50% 40%, rgba(240,185,152,0.05) 0%, transparent 70%)",
      }}
    />
  );
}

export function CinemaLoading() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] w-screen h-screen flex flex-col items-center justify-center overflow-hidden"
      style={{
        background: "linear-gradient(160deg, #1a1610 0%, #120008 100%)",
      }}
    >
      {/* Ambient stage glow — warm apricot instead of red */}
      <div
        className="absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 60%, rgba(240,185,152,0.09) 0%, transparent 70%)",
        }}
      />

      {/* Screen reveal bloom — coral tint */}
      <motion.div
        className="absolute inset-0 z-[1]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.9 }}
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(244,112,91,0.07) 0%, transparent 60%)",
        }}
      />

      {/* Stage light beam */}
      <StageLight />

      {/* Floor spotlight — apricot */}
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-72 h-32 z-0"
        style={{
          background:
            "radial-gradient(ellipse, rgba(240,185,152,0.06) 0%, transparent 70%)",
          filter: "blur(8px)",
        }}
      />

      {/* Curtain rod */}
      <CurtainRod />

      {/* Curtain panels */}
      <div className="absolute inset-0 flex z-10" style={{ paddingTop: 18 }}>
        <CurtainPanel side="left" />
        <CurtainPanel side="right" />
      </div>

      {/* Center content reveal */}
      <motion.div
        className="relative z-20 flex flex-col items-center gap-3"
        initial={{ opacity: 0, scale: 0.92, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 1.9, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <img
          src="/animated_heart_icon.svg"
          alt="Loading"
          className="h-24 w-24"
        />
      </motion.div>
    </div>
  );
}