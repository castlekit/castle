"use client";

import { forwardRef, createContext, useContext, type HTMLAttributes, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface OptionCardGroupContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const OptionCardGroupContext = createContext<OptionCardGroupContextValue | null>(null);

export interface OptionCardGroupProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  onValueChange: (value: string) => void;
}

const OptionCardGroup = forwardRef<HTMLDivElement, OptionCardGroupProps>(
  ({ className, value, onValueChange, children, ...props }, ref) => {
    return (
      <OptionCardGroupContext.Provider value={{ value, onValueChange }}>
        <div
          ref={ref}
          role="radiogroup"
          className={cn("flex flex-col gap-3", className)}
          {...props}
        >
          {children}
        </div>
      </OptionCardGroupContext.Provider>
    );
  }
);

OptionCardGroup.displayName = "OptionCardGroup";

export interface OptionCardProps extends HTMLAttributes<HTMLButtonElement> {
  value: string;
  disabled?: boolean;
  children: ReactNode;
}

const OptionCard = forwardRef<HTMLButtonElement, OptionCardProps>(
  ({ className, value, disabled = false, children, ...props }, ref) => {
    const context = useContext(OptionCardGroupContext);
    
    if (!context) {
      throw new Error("OptionCard must be used within an OptionCardGroup");
    }
    
    const isSelected = context.value === value;
    
    const handleClick = () => {
      if (!disabled) {
        context.onValueChange(value);
      }
    };
    
    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={isSelected}
        data-state={isSelected ? "checked" : "unchecked"}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          "flex items-center gap-4 w-full px-4 py-3 rounded-[var(--radius-md)] border-2 transition-all text-left",
          "interactive",
          isSelected
            ? "border-accent bg-accent/5"
            : "border-[var(--input-border)] bg-[var(--input-background)] hover:border-border-hover",
          disabled && "opacity-50",
          className
        )}
        {...props}
      >
        <div
          className={cn(
            "h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors",
            isSelected ? "border-accent" : "border-[var(--input-border)]"
          )}
        >
          {isSelected && (
            <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          )}
        </div>
        <div className="flex-1">{children}</div>
      </button>
    );
  }
);

OptionCard.displayName = "OptionCard";

export interface CheckboxCardProps extends HTMLAttributes<HTMLButtonElement> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}

const CheckboxCard = forwardRef<HTMLButtonElement, CheckboxCardProps>(
  ({ className, checked = false, onCheckedChange, disabled = false, children, ...props }, ref) => {
    const handleClick = () => {
      if (!disabled) {
        onCheckedChange?.(!checked);
      }
    };
    
    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={checked}
        data-state={checked ? "checked" : "unchecked"}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          "flex items-center gap-4 w-full px-4 py-3 rounded-[var(--radius-md)] border-2 transition-all text-left",
          "interactive",
          checked
            ? "border-accent bg-accent/5"
            : "border-[var(--input-border)] bg-[var(--input-background)] hover:border-border-hover",
          disabled && "opacity-50",
          className
        )}
        {...props}
      >
        <div
          className={cn(
            "h-5 w-5 shrink-0 rounded-[var(--radius-sm)] border-2 flex items-center justify-center transition-colors",
            checked
              ? "border-accent bg-accent text-white"
              : "border-[var(--input-border)] bg-[var(--input-background)]"
          )}
        >
          {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </div>
        <div className="flex-1">{children}</div>
      </button>
    );
  }
);

CheckboxCard.displayName = "CheckboxCard";

export { OptionCardGroup, OptionCard, CheckboxCard };
