"use client";

import { forwardRef, createContext, useContext, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ToggleGroupContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const ToggleGroupContext = createContext<ToggleGroupContextValue | null>(null);

export interface ToggleGroupProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  onValueChange: (value: string) => void;
}

const ToggleGroup = forwardRef<HTMLDivElement, ToggleGroupProps>(
  ({ className, value, onValueChange, children, ...props }, ref) => {
    return (
      <ToggleGroupContext.Provider value={{ value, onValueChange }}>
        <div
          ref={ref}
          role="group"
          className={cn(
            "inline-flex items-center rounded-[var(--radius-sm)] bg-surface border border-border p-1 gap-1",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </ToggleGroupContext.Provider>
    );
  }
);

ToggleGroup.displayName = "ToggleGroup";

export interface ToggleGroupItemProps extends HTMLAttributes<HTMLButtonElement> {
  value: string;
  disabled?: boolean;
  children: ReactNode;
}

const ToggleGroupItem = forwardRef<HTMLButtonElement, ToggleGroupItemProps>(
  ({ className, value, disabled = false, children, ...props }, ref) => {
    const context = useContext(ToggleGroupContext);
    
    if (!context) {
      throw new Error("ToggleGroupItem must be used within a ToggleGroup");
    }
    
    const isSelected = context.value === value;
    
    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={isSelected}
        data-state={isSelected ? "on" : "off"}
        disabled={disabled}
        onClick={() => !disabled && context.onValueChange(value)}
        className={cn(
          "inline-flex items-center justify-center h-8 px-3 rounded-[var(--radius-sm)] text-sm font-medium transition-all",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
          "disabled:pointer-events-none disabled:opacity-50",
          "cursor-pointer",
          isSelected
            ? "bg-background text-foreground shadow-sm"
            : "text-foreground-secondary hover:text-foreground hover:bg-surface-hover",
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

ToggleGroupItem.displayName = "ToggleGroupItem";

export { ToggleGroup, ToggleGroupItem };
