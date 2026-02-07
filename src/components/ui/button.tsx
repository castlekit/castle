import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "destructive" | "outline";
  size?: "sm" | "md" | "lg" | "icon";
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors rounded-[var(--radius-sm)] interactive disabled:pointer-events-none",
          {
            "bg-accent text-accent-foreground hover:bg-accent-hover":
              variant === "primary",
            "bg-surface text-foreground border border-border hover:bg-surface-hover hover:border-border-hover":
              variant === "secondary",
            "bg-transparent text-foreground hover:bg-surface":
              variant === "ghost",
            "bg-error text-white hover:bg-error/90": variant === "destructive",
            "bg-transparent text-foreground border border-border hover:bg-surface hover:border-border-hover":
              variant === "outline",
          },
          {
            "h-8 px-3 text-sm": size === "sm",
            "h-10 px-4 text-sm": size === "md",
            "h-12 px-6 text-base": size === "lg",
            "h-10 w-10 p-0": size === "icon",
          },
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button };
