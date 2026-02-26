"use client";

import { cn } from "@/lib/utils";

interface BorderBeamProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
}

export function BorderBeam({
  className,
  size = 200,
  duration = 12,
  delay = 0,
  colorFrom = "#3b82f6",
  colorTo = "#10b981",
  ...props
}: BorderBeamProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] [border:1px_solid_transparent]",
        className
      )}
      style={
        {
          "--border-beam-size": `${size}px`,
          "--border-beam-duration": `${duration}s`,
          "--border-beam-delay": `${delay}s`,
          "--border-beam-color-from": colorFrom,
          "--border-beam-color-to": colorTo,
          backgroundImage: `conic-gradient(from calc(var(--border-beam-angle, 0) * 1deg), transparent, var(--border-beam-color-from), var(--border-beam-color-to), transparent)`,
          maskImage:
            "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          maskComposite: "exclude",
          WebkitMaskComposite: "xor",
          padding: "1px",
          animation: `border-beam-spin var(--border-beam-duration) linear infinite`,
          animationDelay: `var(--border-beam-delay)`,
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
