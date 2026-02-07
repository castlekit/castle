"use client";

import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

export interface ThemeToggleProps {
  className?: string;
  collapsed?: boolean;
}

function ThemeToggle({ className, collapsed = false }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        className={cn(
          "flex items-center gap-3 p-2 rounded-[var(--radius-md)] hover:bg-surface transition-colors",
          collapsed ? "justify-center" : "",
          className
        )}
      >
        <div className="h-5 w-5" />
      </button>
    );
  }

  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "flex items-center gap-3 p-2 rounded-[var(--radius-md)] hover:bg-surface transition-colors text-foreground-secondary hover:text-foreground",
        collapsed ? "justify-center" : "",
        className
      )}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
      {!collapsed && (
        <span className="text-sm">{isDark ? "Light mode" : "Dark mode"}</span>
      )}
    </button>
  );
}

export { ThemeToggle };
