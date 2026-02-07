"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

export interface ProgressProps {
  value: number;
  max: number;
  trend?: number;
  trendLabel?: string;
  variant?: "success" | "accent" | "warning" | "error";
  size?: "sm" | "md" | "lg";
  className?: string;
}

function Progress({
  value,
  max,
  trend,
  trendLabel,
  variant = "success",
  size = "md",
  className,
}: ProgressProps) {
  const percentage = Math.round((value / max) * 100);
  
  const barColors = {
    success: "bg-success",
    accent: "bg-accent",
    warning: "bg-warning",
    error: "bg-error",
  };

  const trendColors = {
    success: "text-success",
    accent: "text-accent",
    warning: "text-warning",
    error: "text-error",
  };

  const sizes = {
    sm: {
      percentage: "text-xl",
      fraction: "text-xs",
      bar: "h-1.5",
      trend: "text-xs",
    },
    md: {
      percentage: "text-2xl",
      fraction: "text-sm",
      bar: "h-2",
      trend: "text-sm",
    },
    lg: {
      percentage: "text-4xl",
      fraction: "text-base",
      bar: "h-3",
      trend: "text-base",
    },
  };

  const sizeConfig = sizes[size];

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between">
        <span className={cn("font-bold text-foreground", sizeConfig.percentage)}>
          {percentage}%
        </span>
        <span className={cn("text-foreground-secondary", sizeConfig.fraction)}>
          {value.toLocaleString()} of {max.toLocaleString()}
        </span>
      </div>

      <div className={cn("w-full bg-border rounded-full overflow-hidden", sizeConfig.bar)}>
        <div
          className={cn("h-full rounded-full transition-all duration-500", barColors[variant])}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {trend !== undefined && (
        <div className="flex items-center gap-2">
          {trend >= 0 ? (
            <TrendingUp className={cn("h-4 w-4", trendColors[variant])} />
          ) : (
            <TrendingDown className="h-4 w-4 text-error" />
          )}
          <span className={cn("font-medium", trend >= 0 ? trendColors[variant] : "text-error", sizeConfig.trend)}>
            {trend >= 0 ? "+" : ""}{trend}%
          </span>
          {trendLabel && (
            <span className={cn("text-foreground-secondary", sizeConfig.trend)}>
              {trendLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export { Progress };
