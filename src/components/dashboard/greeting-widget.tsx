"use client";

import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export interface GreetingWidgetProps {
  name?: string;
  variant?: "solid" | "glass";
  className?: string;
}

function GreetingWidget({ name = "Brian", variant = "solid", className }: GreetingWidgetProps) {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [greeting, setGreeting] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    setMounted(true);
    setGreeting(getGreeting());
    setDate(formatDate());
  }, []);

  const isDark = mounted && theme === "dark";
  const textColor = variant === "solid" ? undefined : (isDark ? 'white' : 'black');

  if (!mounted) {
    return (
      <div className={cn(
        "py-6 flex flex-col justify-center h-full",
        variant === "solid" && "bg-surface rounded-[var(--radius-lg)] px-6 border border-border",
        className
      )}>
        <p className={cn("text-sm mb-1", variant === "solid" && "text-foreground-secondary")}>&nbsp;</p>
        <h1 className={cn("text-4xl font-semibold", variant === "solid" && "text-foreground")}>&nbsp;</h1>
      </div>
    );
  }

  return (
    <div className={cn(
      "py-6 flex flex-col justify-center h-full",
      variant === "solid" && "bg-surface rounded-[var(--radius-lg)] px-6 border border-border",
      className
    )}>
      <p 
        className={cn("text-sm mb-1", variant === "solid" && "text-foreground-secondary")} 
        style={textColor ? { color: textColor } : undefined}
      >
        {date}
      </p>
      <h1 
        className={cn("text-4xl font-semibold", variant === "solid" && "text-foreground")} 
        style={textColor ? { color: textColor } : undefined}
      >
        {greeting}, {name}
      </h1>
    </div>
  );
}

export { GreetingWidget };
