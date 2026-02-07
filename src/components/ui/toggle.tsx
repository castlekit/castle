"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface ToggleProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  size?: "sm" | "md" | "lg";
  label?: string;
}

const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(
  (
    { className, pressed = false, onPressedChange, size = "md", label, ...props },
    ref
  ) => {
    const toggle = (
      <button
        type="button"
        role="switch"
        aria-checked={pressed}
        data-state={pressed ? "on" : "off"}
        onClick={() => onPressedChange?.(!pressed)}
        className={cn(
          "relative inline-flex shrink-0 items-center rounded-[var(--radius-full)] border-2 border-transparent transition-colors interactive",
          pressed ? "bg-accent" : "bg-[var(--input-border)]",
          {
            "h-5 w-9": size === "sm",
            "h-6 w-11": size === "md",
            "h-7 w-14": size === "lg",
          },
          className
        )}
        ref={ref}
        {...props}
      >
        <span
          className={cn(
            "pointer-events-none block rounded-[var(--radius-full)] bg-white shadow-lg ring-0 transition-transform",
            {
              "h-4 w-4": size === "sm",
              "h-5 w-5": size === "md",
              "h-6 w-6": size === "lg",
            },
            pressed
              ? {
                  "translate-x-4": size === "sm",
                  "translate-x-5": size === "md",
                  "translate-x-7": size === "lg",
                }
              : "translate-x-0"
          )}
        />
      </button>
    );

    if (label) {
      return (
        <div className="flex items-center gap-3">
          {toggle}
          <span 
            className="text-sm text-foreground select-none cursor-pointer"
            onClick={() => onPressedChange?.(!pressed)}
          >
            {label}
          </span>
        </div>
      );
    }

    return toggle;
  }
);

Toggle.displayName = "Toggle";

export { Toggle };
