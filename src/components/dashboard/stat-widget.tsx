import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassCard } from "./glass-card";
import { Card } from "@/components/ui/card";

export interface StatWidgetProps {
  label: string;
  value: string | number;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon?: LucideIcon;
  className?: string;
  variant?: "solid" | "glass";
}

function StatWidget({
  label,
  value,
  change,
  changeType = "neutral",
  icon: Icon,
  className,
  variant = "solid",
}: StatWidgetProps) {
  const content = (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm text-foreground-muted mb-1">{label}</p>
        <p className="text-3xl font-semibold text-foreground">{value}</p>
        {change && (
          <p
            className={cn("text-xs mt-2", {
              "text-success": changeType === "positive",
              "text-error": changeType === "negative",
              "text-foreground-muted": changeType === "neutral",
            })}
          >
            {change}
          </p>
        )}
      </div>
      {Icon && (
        <div className="p-2 rounded-[var(--radius-md)] bg-accent/10">
          <Icon className="h-5 w-5 text-accent" />
        </div>
      )}
    </div>
  );

  if (variant === "solid") {
    return (
      <Card variant="bordered" className={cn("p-6", className)}>
        {content}
      </Card>
    );
  }

  return <GlassCard className={className}>{content}</GlassCard>;
}

export { StatWidget };
