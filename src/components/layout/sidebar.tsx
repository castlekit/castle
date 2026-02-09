"use client";

import { useState, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import {
  LayoutDashboard,
  MessageCircle,
  Search,
  User,
  Sun,
  Moon,
  Settings,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { CastleIcon } from "@/components/icons/castle-icon";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";
import { useUserSettings } from "@/lib/hooks/use-user-settings";
import { useSearchContext } from "@/components/providers/search-provider";
import { useAgentStatus, USER_STATUS_ID } from "@/lib/hooks/use-agent-status";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

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
  const router = useRouter();
  const useLinks = !onNavigate;
  const { tooltips: showTooltips } = useUserSettings();
  const { openSearch } = useSearchContext();

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
        "fixed top-[20px] left-[24px] bottom-[20px] flex flex-col z-40 rounded-[var(--radius-md)] w-14",
        variant === "glass" ? "glass" : "bg-surface border border-border",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-center pt-5 pb-[60px]">
        <button
          type="button"
          aria-label="Go to Dashboard"
          onClick={() => useLinks ? router.push("/") : onNavigate?.("dashboard")}
          className="flex items-center justify-center transition-opacity hover:opacity-85 cursor-pointer"
        >
          <CastleIcon className="h-[36px] w-[36px] min-h-[36px] min-w-[36px] shrink-0 text-[var(--logo-color)] -mt-[3px]" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2">
        {/* Search — first item */}
        {showTooltips ? (
          <Tooltip content="Search (⌘K)" side="right">
            <button
              onClick={openSearch}
              className="flex items-center justify-center w-full rounded-[4px] p-2.5 cursor-pointer text-foreground-secondary hover:text-foreground hover:bg-surface-hover"
            >
              <Search className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            </button>
          </Tooltip>
        ) : (
          <div>
            <button
              onClick={openSearch}
              className="flex items-center justify-center w-full rounded-[4px] p-2.5 cursor-pointer text-foreground-secondary hover:text-foreground hover:bg-surface-hover"
            >
              <Search className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            </button>
          </div>
        )}

        {navItems.map((item) => {
          const isActive = effectiveActive === item.id;
          const NavEl = (
            <button
              onClick={() => useLinks ? router.push(item.href) : onNavigate?.(item.id)}
              className={cn(
                "flex items-center justify-center w-full rounded-[4px] p-2.5 cursor-pointer",
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-foreground-secondary hover:text-foreground hover:bg-surface-hover"
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
            </button>
          );

          if (showTooltips) {
            return (
              <Tooltip key={item.id} content={item.label} side="right">
                {NavEl}
              </Tooltip>
            );
          }
          return <div key={item.id}>{NavEl}</div>;
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
  const router = useRouter();
  const { avatarUrl, isLoading: settingsLoading } = useUserSettings();
  const { getStatus } = useAgentStatus();
  const userStatus = getStatus(USER_STATUS_ID);
  const avatarDotStatus = userStatus === "active" ? "online" as const : "offline" as const;
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
    <div ref={menuRef} className="relative flex justify-center pb-[8px]">
      <button
        onClick={() => setOpen(!open)}
        className="group flex items-center justify-center rounded-[4px] cursor-pointer overflow-hidden transition-opacity"
      >
        <Avatar size="sm" status={avatarDotStatus}>
          {settingsLoading ? (
            <AvatarFallback className="skeleton" />
          ) : avatarUrl ? (
            <AvatarImage
              src={avatarUrl}
              alt="You"
              className="grayscale group-hover:grayscale-0 transition-all duration-200"
            />
          ) : (
            <AvatarFallback className="text-foreground-secondary">
              <User className="h-5 w-5" />
            </AvatarFallback>
          )}
        </Avatar>
      </button>

      {open && (
        <div className="absolute left-[calc(100%+8px)] bottom-0 w-48 rounded-[var(--radius-md)] bg-surface border border-border shadow-xl py-1 z-50">
          <button
            onClick={() => { setOpen(false); router.push("/settings"); }}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-foreground-secondary hover:text-foreground hover:bg-surface-hover cursor-pointer"
          >
            <Settings className="h-4 w-4" />
            Settings
          </button>

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
