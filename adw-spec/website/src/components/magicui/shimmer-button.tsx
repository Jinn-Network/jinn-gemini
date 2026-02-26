"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface ShimmerButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  shimmerColor?: string;
  shimmerSize?: string;
  borderRadius?: string;
  shimmerDuration?: string;
  background?: string;
}

export const ShimmerButton = React.forwardRef<
  HTMLButtonElement,
  ShimmerButtonProps
>(
  (
    {
      shimmerColor = "#3b82f6",
      shimmerSize = "0.1em",
      shimmerDuration = "2s",
      borderRadius = "0.5rem",
      background = "rgba(0, 0, 0, 0.8)",
      className,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        style={
          {
            "--shimmer-color": shimmerColor,
            "--radius": borderRadius,
            "--speed": shimmerDuration,
            "--spread": shimmerSize,
            "--bg": background,
          } as React.CSSProperties
        }
        className={cn(
          "group relative z-0 flex cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap px-6 py-3 text-sm font-medium text-white [background:var(--bg)] [border-radius:var(--radius)]",
          "transform-gpu transition-transform duration-300 ease-in-out active:translate-y-px",
          className
        )}
        {...props}
      >
        {/* shimmer */}
        <div
          className={cn(
            "absolute inset-0 overflow-hidden [border-radius:var(--radius)]"
          )}
        >
          <div className="absolute inset-[-100%] animate-[shimmer_var(--speed)_linear_infinite] bg-[conic-gradient(from_0deg,transparent_0_340deg,var(--shimmer-color)_360deg)]" />
        </div>

        {/* backdrop */}
        <div
          className={cn(
            "absolute inset-px [background:var(--bg)] [border-radius:var(--radius)]"
          )}
        />

        {/* content */}
        <span className="relative z-10">{children}</span>
      </button>
    );
  }
);

ShimmerButton.displayName = "ShimmerButton";
