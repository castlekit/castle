"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: string;
}

const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, checked = false, onCheckedChange, label, ...props }, ref) => {
    const checkbox = (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        data-state={checked ? "checked" : "unchecked"}
        onClick={() => onCheckedChange?.(!checked)}
        className={cn(
          "peer h-5 w-5 shrink-0 rounded-[var(--radius-sm)] border-2 transition-colors interactive",
          checked
            ? "bg-accent border-accent text-accent-foreground"
            : "bg-[var(--input-background)] border-[var(--input-border)]",
          className
        )}
        ref={ref}
        {...props}
      >
        {checked && <Check className="h-4 w-4 mx-auto" strokeWidth={3} />}
      </button>
    );

    if (label) {
      return (
        <div className="flex items-center gap-3">
          {checkbox}
          <span 
            className="text-sm text-foreground select-none cursor-pointer"
            onClick={() => onCheckedChange?.(!checked)}
          >
            {label}
          </span>
        </div>
      );
    }

    return checkbox;
  }
);

Checkbox.displayName = "Checkbox";

export { Checkbox };
