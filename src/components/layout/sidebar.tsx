"use client";

import { useState, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import {
  LayoutDashboard,
  MessageCircle,
  User,
  Sun,
  Moon,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { CastleIcon } from "@/components/icons/castle-icon";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserSettings } from "@/lib/hooks/use-user-settings";

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
}

export interface SidebarProps {
  activeItem?: string;
  onNavigate?: (id: string) => void;
  className?: string;
  variant?: "glass" | "solid";
}

const navItems: NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/",
  },
  {
    id: "chat",
    label: "Chat",
    icon: MessageCircle,
    href: "/chat",
  },
];

function Sidebar({ 
  activeItem = "dashboard", 
  onNavigate, 
  className,
  variant = "solid"
}: SidebarProps) {
  const pathname = usePathname();
  const useLinks = !onNavigate;

  const activeFromPath = (() => {
    if (!pathname) return "dashboard";
    if (pathname === "/") return "dashboard";
    if (pathname.startsWith("/chat")) return "chat";
    return "dashboard";
  })();

  const effectiveActive = useLinks ? activeFromPath : activeItem;

  return (
    <aside
      className={cn(
        "fixed top-[20px] left-[24px] bottom-[20px] flex flex-col z-40 rounded-[28px] w-14",
        variant === "glass" ? "glass" : "bg-surface border border-border",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-center pt-5 pb-[60px]">
        {useLinks ? (
          <Link
            href="/"
            aria-label="Go to Dashboard"
            className="flex items-center justify-center transition-opacity hover:opacity-85"
          >
            <CastleIcon className="h-[36px] w-[36px] min-h-[36px] min-w-[36px] shrink-0 text-[var(--logo-color)] -mt-[3px]" />
          </Link>
        ) : (
          <button
            type="button"
            aria-label="Go to Dashboard"
            onClick={() => onNavigate?.("dashboard")}
            className="flex items-center justify-center transition-opacity hover:opacity-85 cursor-pointer"
          >
            <CastleIcon className="h-[36px] w-[36px] min-h-[36px] min-w-[36px] shrink-0 text-[var(--logo-color)] -mt-[3px]" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2">
        {navItems.map((item) => {
          const isActive = effectiveActive === item.id;
          const NavEl = useLinks ? (
            <Link
              href={item.href}
              className={cn(
                "flex items-center justify-center w-full rounded-[20px] p-2.5 cursor-pointer",
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-foreground-secondary hover:text-foreground hover:bg-surface-hover"
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
            </Link>
          ) : (
            <button
              onClick={() => onNavigate?.(item.id)}
              className={cn(
                "flex items-center justify-center w-full rounded-[20px] p-2.5 cursor-pointer",
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-foreground-secondary hover:text-foreground hover:bg-surface-hover"
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
            </button>
          );

          return (
            <Tooltip key={item.id} content={item.label} side="right">
              {NavEl}
            </Tooltip>
          );
        })}
      </nav>

      {/* User menu at bottom */}
      <SidebarUserMenu />
    </aside>
  );
}

function SidebarUserMenu() {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { avatarUrl } = useUserSettings();
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
    <div ref={menuRef} className="relative flex justify-center pb-[10px]">
      <button
        onClick={() => setOpen(!open)}
        className="group flex items-center justify-center rounded-full cursor-pointer overflow-hidden transition-opacity"
      >
        <div className="w-9 h-9 shrink-0 rounded-full overflow-hidden">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="You"
              className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-200"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-foreground-secondary">
              <User className="h-5 w-5" />
            </div>
          )}
        </div>
      </button>

      {open && (
        <div className="absolute left-[calc(100%+8px)] bottom-0 w-48 rounded-[var(--radius-md)] bg-surface border border-border shadow-xl py-1 z-50">
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

export { Sidebar };
