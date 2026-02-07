"use client";

import { cn } from "@/lib/utils";

export interface GoalWidgetProps {
  title: string;
  value: number;
  max?: number;
  unit?: string;
  status?: string;
  statusColor?: string;
  description?: string;
  highlight?: string;
  icon?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  variant?: "solid" | "glass";
  className?: string;
}

const sizeConfig = {
  sm: {
    containerSize: 140,
    padding: "p-2",
    gaugeSize: 86,
    strokeWidth: 5,
    titleSize: "text-xs",
    valueSize: "text-base",
    statusSize: "text-[10px]",
    descSize: "text-[10px]",
    iconContainer: "w-5 h-5",
    iconSize: "w-3 h-3",
  },
  md: {
    containerSize: 180,
    padding: "p-3",
    gaugeSize: 100,
    strokeWidth: 6,
    titleSize: "text-xs",
    valueSize: "text-xl",
    statusSize: "text-xs",
    descSize: "text-[10px]",
    iconContainer: "w-5 h-5",
    iconSize: "w-3 h-3",
  },
  lg: {
    containerSize: 220,
    padding: "p-3",
    gaugeSize: 130,
    strokeWidth: 7,
    titleSize: "text-sm",
    valueSize: "text-2xl",
    statusSize: "text-xs",
    descSize: "text-xs",
    iconContainer: "w-6 h-6",
    iconSize: "w-3.5 h-3.5",
  },
};

function GoalWidget({
  title,
  value,
  max = 100,
  unit,
  status,
  statusColor = "#f97316",
  description,
  highlight,
  icon,
  size = "md",
  variant = "solid",
  className,
}: GoalWidgetProps) {
  const config = sizeConfig[size];
  const percentage = Math.min((value / max) * 100, 100);
  
  const gaugeSize = config.gaugeSize;
  const strokeWidth = config.strokeWidth;
  const radius = (gaugeSize - strokeWidth) / 2;
  const circumference = radius * Math.PI * 1.5;
  const offset = circumference - (percentage / 100) * circumference;
  
  return (
    <div 
      className={cn(
        config.padding, 
        "space-y-1 flex flex-col rounded-[var(--radius-lg)]",
        variant === "glass" ? "glass" : "bg-surface border border-border",
        className
      )}
      style={{ width: config.containerSize, height: config.containerSize }}
    >
      <div className="flex items-start justify-between">
        <div className={cn(config.titleSize, "font-semibold text-foreground")}>{title}</div>
        {icon && (
          <div 
            className={cn(config.iconContainer, "rounded-full flex items-center justify-center")}
            style={{ backgroundColor: statusColor }}
          >
            <div className={config.iconSize}>
              {icon}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="relative" style={{ width: gaugeSize, height: gaugeSize }}>
          <svg
            width={gaugeSize}
            height={gaugeSize}
            className="transform -rotate-[225deg]"
            style={{ overflow: 'visible' }}
          >
            <circle
              cx={gaugeSize / 2}
              cy={gaugeSize / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={0}
              className="text-foreground/10"
            />
            <circle
              cx={gaugeSize / 2}
              cy={gaugeSize / 2}
              r={radius}
              fill="none"
              stroke={statusColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn(config.valueSize, "font-bold text-foreground")}>
              {value}{unit}
            </span>
            {status && (
              <span 
                className={cn(config.statusSize, "font-medium")}
                style={{ color: statusColor }}
              >
                {status}
              </span>
            )}
          </div>
        </div>
      </div>

      {description && (
        <p className={cn(config.descSize, "text-foreground/60 text-center")}>
          {highlight ? (
            <>
              {description.split(highlight)[0]}
              <span style={{ color: statusColor }} className="font-medium">
                {highlight}
              </span>
              {description.split(highlight)[1]}
            </>
          ) : (
            description
          )}
        </p>
      )}
    </div>
  );
}

export { GoalWidget };
