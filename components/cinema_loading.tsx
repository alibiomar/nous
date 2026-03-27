import { motion } from "framer-motion";
import { useEffect } from "react";


// Curtain fold/pleat column
function CurtainPanel({ side }: { side: "left" | "right" }) {
  const isLeft = side === "left";
  const foldCount = 7;

  return (
    <motion.div
      className="relative w-1/2 h-full overflow-hidden"
      style={{ transformOrigin: isLeft ? "left center" : "right center" }}
      initial={{ x: 0, scaleX: 1 }}
animate={{ x: isLeft ? "-100%" : "100%", scaleX: 0.95 }}
      transition={{
  duration: 2.2,
  ease: [0.65, 0, 0.35, 1], // more cinematic weight
  delay: 0.3
}}
    >
      {/* Base curtain fabric */}
      <div
        className="absolute inset-0"
        style={{
          background: isLeft
            ? `linear-gradient(to right,
                #5a0a0a 0%,
                #8b1010 8%,
                #6b0d0d 15%,
                #a01414 22%,
                #6b0d0d 30%,
                #8b1010 37%,
                #5a0a0a 44%,
                #7a0e0e 50%,
                #5a0a0a 56%,
                #8b1010 63%,
                #6b0d0d 70%,
                #a01414 77%,
                #6b0d0d 84%,
                #8b1010 92%,
                #3d0707 100%)`
            : `linear-gradient(to left,
                #5a0a0a 0%,
                #8b1010 8%,
                #6b0d0d 15%,
                #a01414 22%,
                #6b0d0d 30%,
                #8b1010 37%,
                #5a0a0a 44%,
                #7a0e0e 50%,
                #5a0a0a 56%,
                #8b1010 63%,
                #6b0d0d 70%,
                #a01414 77%,
                #6b0d0d 84%,
                #8b1010 92%,
                #3d0707 100%)`,
        }}
      />

      {/* Vertical fold shadows — pleats */}
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
                    rgba(0,0,0,0.55) 0%,
                    rgba(0,0,0,0.1) 30%,
                    rgba(255,255,255,0.04) 55%,
                    rgba(0,0,0,0.3) 100%)`
                : `linear-gradient(to left,
                    rgba(0,0,0,0.55) 0%,
                    rgba(0,0,0,0.1) 30%,
                    rgba(255,255,255,0.04) 55%,
                    rgba(0,0,0,0.3) 100%)`,
            }}
          />
        );
      })}

      {/* Fabric noise / texture overlay */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundSize: "150px 150px",
          mixBlendMode: "overlay",
        }}
      />

      {/* Sheen highlight along leading edge */}
      <div
        className="absolute top-0 bottom-0 w-6"
        style={{
          [isLeft ? "right" : "left"]: 0,
          background: isLeft
            ? "linear-gradient(to left, rgba(255,200,150,0.12) 0%, transparent 100%)"
            : "linear-gradient(to right, rgba(255,200,150,0.12) 0%, transparent 100%)",
        }}
      />

      {/* Curtain rod rings at top */}
      <div className="absolute top-0 left-0 right-0 flex justify-around px-2 pt-1 z-10">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-full border border-yellow-600/70"
            style={{
              width: 10,
              height: 14,
              background:
                "radial-gradient(circle at 35% 35%, #d4a017, #7a5c00)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.6)",
            }}
          />
        ))}
      </div>

      {/* Bottom gather / puddle */}
      <div
        className="absolute bottom-0 left-0 right-0 h-16"
        style={{
          background: isLeft
            ? `linear-gradient(to right,
                rgba(30,0,0,0.9) 0%,
                rgba(80,0,0,0.6) 20%,
                rgba(50,0,0,0.8) 40%,
                rgba(90,0,0,0.5) 60%,
                rgba(40,0,0,0.85) 80%,
                rgba(20,0,0,0.95) 100%)`
            : `linear-gradient(to left,
                rgba(30,0,0,0.9) 0%,
                rgba(80,0,0,0.6) 20%,
                rgba(50,0,0,0.8) 40%,
                rgba(90,0,0,0.5) 60%,
                rgba(40,0,0,0.85) 80%,
                rgba(20,0,0,0.95) 100%)`,
          filter: "blur(1px)",
        }}
      />
    </motion.div>
  );
}

// The golden curtain rod across the top
function CurtainRod() {
  return (
    <div
      className="absolute top-0 left-0 right-0 z-20"
      style={{ height: 18 }}
    >
      <div
        className="w-full h-full"
        style={{
          background:
            "linear-gradient(to bottom, #f0c040 0%, #b8860b 40%, #7a5c00 70%, #c8a000 100%)",
          boxShadow: "0 3px 12px rgba(0,0,0,0.8), inset 0 1px 1px rgba(255,255,200,0.4)",
        }}
      />
      {/* Rod end caps */}
      {["left-0", "right-0"].map((pos) => (
        <div
          key={pos}
          className={`absolute top-0 ${pos} w-5 h-full rounded-full`}
          style={{
            background:
              "radial-gradient(circle at 40% 40%, #f5d060, #8a6500)",
            boxShadow: "0 2px 6px rgba(0,0,0,0.7)",
          }}
        />
      ))}
    </div>
  );
}

export function CinemaLoading() {
  useEffect(() => {
  document.body.style.overflow = "hidden";
  return () => {
    document.body.style.overflow = "auto";
  };
}, []);
  return (
    <div
className="fixed inset-0 z-[9999] w-screen h-screen flex flex-col items-center justify-center overflow-hidden"        style={{
        background: "linear-gradient(160deg, #0a0a0f 0%, #120008 100%)",
      }}
    >
      {/* Ambient stage glow behind curtains */}
      <div
        className="absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 60%, rgba(180,20,20,0.18) 0%, transparent 70%)",
        }}
      />
<motion.div
  className="absolute inset-0 z-10"
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ delay: 1.2 }}
  style={{
    background:
      "radial-gradient(ellipse at center, rgba(255,255,255,0.06) 0%, transparent 60%)",
  }}
/>
      {/* Floor spotlight */}
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-72 h-32 z-0"
        style={{
          background:
            "radial-gradient(ellipse, rgba(255,220,100,0.08) 0%, transparent 70%)",
          filter: "blur(8px)",
        }}
      />

      {/* Curtain rod */}
      <CurtainRod />

      {/* Curtain panels */}
      <div className="absolute inset-0 flex z-10 pt-[18px]">
        <CurtainPanel side="left" />
        <CurtainPanel side="right" />
      </div>

      {/* Screen content reveal */}
      <motion.div
        className="relative z-20 flex flex-col items-center gap-3"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1.8, duration: 0.6, ease: "easeOut" }}
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