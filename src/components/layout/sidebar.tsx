"use client";

import {
  LayoutDashboard,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import { Fragment } from "react";
import { CastleIcon } from "@/components/icons/castle-icon";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
        "fixed top-5 left-6 bottom-5 flex flex-col z-40 shadow-xl shadow-black/20 rounded-[28px] w-14",
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

      {/* Spacer at bottom for visual balance */}
      <div className="pb-4" />
    </aside>
  );
}

export { Sidebar };
