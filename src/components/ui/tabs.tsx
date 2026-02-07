"use client";

import { forwardRef, createContext, useContext, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  onValueChange: (value: string) => void;
}

const Tabs = forwardRef<HTMLDivElement, TabsProps>(
  ({ className, value, onValueChange, children, ...props }, ref) => {
    return (
      <TabsContext.Provider value={{ value, onValueChange }}>
        <div ref={ref} className={cn("w-full", className)} {...props}>
          {children}
        </div>
      </TabsContext.Provider>
    );
  }
);

Tabs.displayName = "Tabs";

export type TabsListProps = HTMLAttributes<HTMLDivElement>;

const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="tablist"
        className={cn(
          "inline-flex items-center gap-1 border-b border-border",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

TabsList.displayName = "TabsList";

export interface TabsTriggerProps extends HTMLAttributes<HTMLButtonElement> {
  value: string;
  disabled?: boolean;
}

const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, disabled = false, children, ...props }, ref) => {
    const context = useContext(TabsContext);
    
    if (!context) {
      throw new Error("TabsTrigger must be used within Tabs");
    }
    
    const isSelected = context.value === value;
    
    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={isSelected}
        data-state={isSelected ? "active" : "inactive"}
        disabled={disabled}
        onClick={() => !disabled && context.onValueChange(value)}
        className={cn(
          "relative px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
          "disabled:pointer-events-none disabled:opacity-50",
          isSelected
            ? "text-foreground"
            : "text-foreground-muted hover:text-foreground",
          className
        )}
        {...props}
      >
        {children}
        {isSelected && (
          <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
        )}
      </button>
    );
  }
);

TabsTrigger.displayName = "TabsTrigger";

export interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
}

const TabsContent = forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, children, ...props }, ref) => {
    const context = useContext(TabsContext);
    
    if (!context) {
      throw new Error("TabsContent must be used within Tabs");
    }
    
    if (context.value !== value) {
      return null;
    }
    
    return (
      <div
        ref={ref}
        role="tabpanel"
        tabIndex={0}
        className={cn("mt-4 focus-visible:outline-none", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);

TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
