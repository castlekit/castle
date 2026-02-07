import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "error" | "info" | "outline";
  size?: "sm" | "md";
}

function Badge({
  className,
  variant = "default",
  size = "md",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-[var(--radius-full)] transition-colors",
        {
          "bg-surface text-foreground-secondary": variant === "default",
          "bg-success/10 text-success": variant === "success",
          "bg-warning/10 text-warning": variant === "warning",
          "bg-error/10 text-error": variant === "error",
          "bg-info/10 text-info": variant === "info",
          "bg-transparent text-foreground-secondary border border-border":
            variant === "outline",
        },
        {
          "px-2 py-0.5 text-xs": size === "sm",
          "px-2.5 py-0.5 text-sm": size === "md",
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };
