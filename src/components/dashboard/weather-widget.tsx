"use client";

import { Cloud, Sun, CloudRain, CloudSnow, Wind } from "lucide-react";
import { cn } from "@/lib/utils";

type WeatherCondition = "sunny" | "cloudy" | "rainy" | "snowy" | "windy";

export interface WeatherWidgetProps {
  temperature?: number;
  condition?: WeatherCondition;
  location?: string;
  high?: number;
  low?: number;
  variant?: "solid" | "glass";
  className?: string;
}

const weatherIcons: Record<WeatherCondition, typeof Sun> = {
  sunny: Sun,
  cloudy: Cloud,
  rainy: CloudRain,
  snowy: CloudSnow,
  windy: Wind,
};

function WeatherWidget({
  temperature = 12,
  condition = "cloudy",
  location = "Zurich",
  high = 15,
  low = 8,
  variant = "solid",
  className,
}: WeatherWidgetProps) {
  const Icon = weatherIcons[condition];

  return (
    <div className={cn(
      "rounded-[var(--radius-lg)] p-6",
      variant === "glass" ? "glass" : "bg-surface border border-border",
      className
    )}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-foreground-secondary mb-1">{location}</p>
          <div className="flex items-baseline gap-1">
            <span className="text-5xl font-light text-foreground">
              {temperature}
            </span>
            <span className="text-2xl text-foreground-secondary">°C</span>
          </div>
          <p className="text-sm text-foreground-secondary mt-2 capitalize">
            {condition}
          </p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Icon className="h-12 w-12 text-foreground-secondary" strokeWidth={1.5} />
          <div className="flex gap-3 text-xs text-foreground-muted">
            <span>H: {high}°</span>
            <span>L: {low}°</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export { WeatherWidget };
