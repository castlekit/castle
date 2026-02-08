"use client";

import { useState, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { User, Sun, Moon, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export interface UserMenuProps {
  className?: string;
  variant?: "glass" | "solid";
}

function UserMenu({ className, variant = "solid" }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isDark = theme === "dark";

  return (
    <div ref={menuRef} className={cn("relative", className)}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center justify-center h-14 w-14 rounded-[28px] shadow-xl shadow-black/20 text-foreground-secondary hover:text-foreground cursor-pointer",
          variant === "glass" ? "glass" : "bg-surface border border-border"
        )}
      >
        <User className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-48 rounded-[var(--radius-md)] bg-surface border border-border shadow-xl py-1 z-50">
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-foreground-secondary hover:text-foreground hover:bg-surface-hover cursor-pointer"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>

          {mounted && (
            <button
              onClick={() => {
                setTheme(isDark ? "light" : "dark");
                setOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-foreground-secondary hover:text-foreground hover:bg-surface-hover cursor-pointer"
            >
              {isDark ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
              {isDark ? "Light mode" : "Dark mode"}
            </button>
          )}

        </div>
      )}
    </div>
  );
}

export { UserMenu };
