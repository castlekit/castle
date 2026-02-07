"use client";

import { cn } from "@/lib/utils";

export type UptimeStatus = "loading" | "operational" | "degraded" | "partial" | "major" | "maintenance";

export interface UptimeProps {
  title: string;
  status: UptimeStatus;
  uptimePercent?: number;
  message?: string;
  data?: number[];
  labels?: string[];
  barCount?: number;
  className?: string;
}

const statusConfig: Record<UptimeStatus, { label: string; color: string; dot: string }> = {
  loading: { label: "Checking...", color: "bg-foreground/5 text-foreground-secondary", dot: "bg-foreground/30" },
  operational: { label: "Operational", color: "bg-success/10 text-success", dot: "bg-success" },
  degraded: { label: "Degraded", color: "bg-warning/10 text-warning", dot: "bg-warning" },
  partial: { label: "Partial Outage", color: "bg-warning/10 text-warning", dot: "bg-warning" },
  major: { label: "Major Outage", color: "bg-error/10 text-error", dot: "bg-error" },
  maintenance: { label: "Maintenance", color: "bg-info/10 text-info", dot: "bg-info" },
};

function getBarColor(value: number): string {
  if (value < 0) return "bg-foreground/10";
  if (value >= 99) return "bg-success";
  if (value >= 95) return "bg-success/70";
  if (value >= 90) return "bg-warning";
  if (value >= 50) return "bg-warning/70";
  return "bg-error";
}

function Uptime({
  title,
  status,
  message,
  data = [],
  labels = [],
  barCount = 45,
  className,
}: UptimeProps) {
  const config = statusConfig[status];
  
  const bars = data === undefined
    ? null
    : data.length > 0 
      ? data.slice(-barCount) 
      : Array(barCount).fill(-1);

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        {status === "loading" ? (
          <span className="inline-flex items-center gap-2 px-3 py-1 text-sm text-foreground-secondary">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </span>
        ) : (
          <span className={cn(
            "inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium transition-opacity duration-300",
            config.color
          )}>
            <span className={cn("h-2 w-2 rounded-full", config.dot)} />
            {config.label}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-foreground-secondary">Uptime</span>
        <span className="text-sm text-foreground-secondary" suppressHydrationWarning>
          {message}
        </span>
      </div>

      <div className="flex justify-between mb-2 h-8">
        {bars?.map((value, i) => (
          <div
            key={i}
            className={cn(
              "h-8 w-1 rounded-full",
              getBarColor(value)
            )}
            title={value < 0 ? "No data" : `${value}%`}
          />
        ))}
      </div>

      {labels.length > 0 && (
        <div className="flex justify-between text-xs text-foreground-muted">
          {labels.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export { Uptime };
