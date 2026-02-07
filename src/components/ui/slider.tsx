"use client";

import { forwardRef, useState } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

export interface SliderProps
  extends React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  label?: string;
  showValue?: boolean;
}

const Slider = forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(({ className, label, showValue = false, value, defaultValue, onValueChange, ...props }, ref) => {
  const [internalValue, setInternalValue] = useState(defaultValue ?? [0]);
  
  const displayValue = value ?? internalValue;
  
  const handleValueChange = (newValue: number[]) => {
    setInternalValue(newValue);
    onValueChange?.(newValue);
  };
  
  return (
    <div className="w-full">
      {(label || showValue) && (
        <div className="flex items-center justify-between mb-3">
          {label && (
            <label className="text-sm text-foreground-muted">{label}</label>
          )}
          {showValue && (
            <span className="text-sm text-foreground tabular-nums">
              {displayValue[0]}
            </span>
          )}
        </div>
      )}
      <SliderPrimitive.Root
        ref={ref}
        className={cn(
          "relative flex w-full touch-none select-none items-center",
          className
        )}
        value={value}
        defaultValue={defaultValue}
        onValueChange={handleValueChange}
        {...props}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-border">
          <SliderPrimitive.Range className="absolute h-full bg-accent" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-accent bg-white shadow-md transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 hover:scale-110" />
      </SliderPrimitive.Root>
    </div>
  );
});

Slider.displayName = "Slider";

export { Slider };
