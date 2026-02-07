"use client";

import { forwardRef, createContext, useContext, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface RadioGroupContextValue {
  value: string;
  onValueChange: (value: string) => void;
  name: string;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export interface RadioGroupProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  onValueChange: (value: string) => void;
  name?: string;
}

const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
  ({ className, value, onValueChange, name = "radio-group", children, ...props }, ref) => {
    return (
      <RadioGroupContext.Provider value={{ value, onValueChange, name }}>
        <div
          ref={ref}
          role="radiogroup"
          className={cn("flex flex-col gap-3", className)}
          {...props}
        >
          {children}
        </div>
      </RadioGroupContext.Provider>
    );
  }
);

RadioGroup.displayName = "RadioGroup";

export interface RadioGroupItemProps extends HTMLAttributes<HTMLButtonElement> {
  value: string;
  label?: string;
  disabled?: boolean;
}

const RadioGroupItem = forwardRef<HTMLButtonElement, RadioGroupItemProps>(
  ({ className, value, label, disabled = false, ...props }, ref) => {
    const context = useContext(RadioGroupContext);
    
    if (!context) {
      throw new Error("RadioGroupItem must be used within a RadioGroup");
    }
    
    const isSelected = context.value === value;
    
    const handleClick = () => {
      if (!disabled) {
        context.onValueChange(value);
      }
    };
    
    const radio = (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={isSelected}
        data-state={isSelected ? "checked" : "unchecked"}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          "h-5 w-5 shrink-0 rounded-full border-2 transition-colors interactive",
          "flex items-center justify-center",
          isSelected
            ? "border-accent"
            : "border-[var(--input-border)] bg-[var(--input-background)]",
          className
        )}
        {...props}
      >
        {isSelected && (
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
        )}
      </button>
    );
    
    if (label) {
      return (
        <div className="flex items-center gap-3">
          {radio}
          <span 
            className={cn(
              "text-sm select-none cursor-pointer",
              disabled ? "text-foreground-muted" : "text-foreground"
            )}
            onClick={handleClick}
          >
            {label}
          </span>
        </div>
      );
    }
    
    return radio;
  }
);

RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };
