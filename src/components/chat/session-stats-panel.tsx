"use client";

import { useState, useRef, useCallback, useLayoutEffect } from "react";
import {
  Brain,
  Minimize2,
  Loader2,
  Eye,
  FileText,
  Wrench,
  Sparkles,
  FolderOpen,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SessionStatus } from "@/lib/types/chat";

interface SessionStatsPanelProps {
  stats: SessionStatus | null;
  isLoading?: boolean;
  className?: string;
  /** Whether a compaction is currently in progress */
  isCompacting?: boolean;
  /** Live compaction count observed via SSE (since mount) */
  liveCompactionCount?: number;
}

/** Simple relative time helper */
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Get context dot/bar color based on usage percentage */
function getContextColor(percentage: number): string {
  if (percentage >= 90) return "bg-error";
  if (percentage >= 80) return "bg-orange-500";
  if (percentage >= 60) return "bg-yellow-500";
  return "bg-success";
}

function getContextTextColor(percentage: number): string {
  if (percentage >= 90) return "text-error/60 group-hover:text-error";
  if (percentage >= 80) return "text-orange-500/55 group-hover:text-orange-500";
  if (percentage >= 60) return "text-yellow-500/55 group-hover:text-yellow-500";
  return "text-foreground-secondary/60 group-hover:text-foreground-secondary";
}

/** Returns a raw CSS color for inline styles */
function getContextColorValue(percentage: number): string {
  if (percentage >= 90) return "#ef4444";
  if (percentage >= 80) return "#f97316";
  if (percentage >= 60) return "#eab308";
  return "#22c55e";
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}k`;
  }
  return String(n);
}

function formatChars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M chars`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k chars`;
  return `${n} chars`;
}

// ============================================================================
// Compact stats indicator — sits between text input and send button
// ============================================================================

export function SessionStatsIndicator({
  stats,
  isLoading,
  isCompacting,
}: SessionStatsPanelProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  const boxElRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  const boxRef = useCallback((el: HTMLDivElement | null) => {
    // Cleanup previous observer
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    boxElRef.current = el;
    if (el) {
      setBoxSize({ w: el.offsetWidth, h: el.offsetHeight });
      const ro = new ResizeObserver(() => {
        setBoxSize({ w: el.offsetWidth, h: el.offsetHeight });
      });
      ro.observe(el);
      roRef.current = ro;
    }
  }, []);

  // Cleanup on unmount
  useLayoutEffect(() => {
    return () => roRef.current?.disconnect();
  }, []);

  const percentage = stats?.context?.percentage ?? 0;
  const textColor = getContextTextColor(percentage);
  const progressColor = getContextColorValue(percentage);
  const displayCompactions = stats?.compactions ?? 0;


  // Build CCW path starting from a point on the top edge (offset from TL),
  // then left to TL corner → down left → bottom → up right → TR → top edge → Z
  const r = 6;
  const s = 0.75; // inset = half stroke width
  const { w, h } = boxSize;
  // Start point: offset along the top edge so initial fill is visible there
  const startX = w > 0 ? Math.min(r + s + 5, w * 0.2) : 0;
  const pathD =
    w > 0 && h > 0
      ? [
          `M ${startX} ${s}`,                         // start: top edge, offset from left
          `L ${r + s} ${s}`,                          // left along top to TL corner
          `A ${r} ${r} 0 0 0 ${s} ${r + s}`,        // TL corner arc (CCW)
          `L ${s} ${h - r - s}`,                      // down left edge
          `A ${r} ${r} 0 0 0 ${r + s} ${h - s}`,    // BL corner arc
          `L ${w - r - s} ${h - s}`,                  // right along bottom
          `A ${r} ${r} 0 0 0 ${w - s} ${h - r - s}`, // BR corner arc
          `L ${w - s} ${r + s}`,                      // up right edge
          `A ${r} ${r} 0 0 0 ${w - r - s} ${s}`,    // TR corner arc
          `Z`,                                        // top edge back to start
        ].join(" ")
      : "";

  // Always fill at least a visible initial segment on the top edge
  const minPct = stats ? Math.max(percentage, 3) : 0;

  return (
    <>
      {/* Stats box with SVG border progress */}
      <div
        ref={boxRef}
        className="group relative h-[38px] min-w-[146px] shrink-0 rounded-[var(--radius-sm)] cursor-pointer"
        onClick={() => setModalOpen(true)}
        title="View session details"
      >
        {/* Track border */}
        <div className="absolute inset-0 rounded-[var(--radius-sm)] border border-border" />
        {/* Progress border — CCW from top-left */}
        {pathD && (
          <svg className="absolute inset-0 w-full h-full opacity-45 group-hover:opacity-100 transition-opacity" fill="none">
            <path
              d={pathD}
              stroke={progressColor}
              strokeWidth="1.5"
              pathLength="100"
              strokeDasharray={`${minPct} ${100 - minPct}`}
            />
          </svg>
        )}
        {/* Content */}
        <button
          type="button"
          className="relative h-full w-full rounded-[var(--radius-sm)] bg-transparent flex items-center justify-center gap-2.5 px-3 text-xs text-foreground-secondary hover:text-foreground transition-colors cursor-pointer"
        >
          {stats ? (
            <>
              <span className={cn("tabular-nums whitespace-nowrap transition-colors", textColor)}>
                {formatTokens(stats.context.used)} · {percentage}%
              </span>
              {isCompacting && (
                <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
              )}
            <span className="w-px h-4 bg-border shrink-0" />
            <span className="flex items-center gap-0.5 text-foreground-secondary/60 group-hover:text-foreground-secondary transition-colors">
              <Minimize2 className="h-3.5 w-3.5" />
              {displayCompactions}
            </span>
            </>
          ) : (
            <>
              <span className="skeleton h-3 w-[72px] rounded" />
              <span className="w-px h-4 bg-border/50 shrink-0" />
              <span className="skeleton h-3 w-[28px] rounded" />
            </>
          )}
        </button>
      </div>

      {/* Full stats modal */}
      <SessionStatsModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        stats={stats}
        isCompacting={isCompacting}
      />
    </>
  );
}

// ============================================================================
// Full stats modal — beautiful breakdown of session state
// ============================================================================

function SessionStatsModal({
  open,
  onClose,
  stats,
  isCompacting,
}: {
  open: boolean;
  onClose: () => void;
  stats: SessionStatus | null;
  isCompacting?: boolean;
}) {
  if (!stats) return null;

  const percentage = stats.context.percentage;
  const contextColor = getContextColor(percentage);
  const headroom = stats.context.limit - stats.context.used;
  const headroomPct = Math.max(0, 100 - percentage);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-foreground-secondary" />
          Session
        </DialogTitle>
        <p className="text-sm text-foreground-secondary mt-1">
          {stats.model} · {stats.modelProvider}
        </p>
      </DialogHeader>

      <div className="space-y-5">
        {/* Context window — hero section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground-secondary flex items-center gap-1.5">
              <Eye className="h-4 w-4" />
              Context Window
            </span>
            <span className="font-mono font-medium">
              {percentage}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-4 bg-surface-hover rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-500", contextColor)}
              style={{ width: `${Math.min(percentage, 100)}%` }}
            />
          </div>

          {/* Token counts */}
          <div className="flex items-center justify-between text-xs text-foreground-secondary">
            <span>
              <span className="font-medium text-foreground">{formatTokens(stats.context.used)}</span> used
            </span>
            <span>
              <span className="font-medium text-foreground">{formatTokens(headroom)}</span> headroom
            </span>
            <span>
              <span className="font-medium text-foreground">{formatTokens(stats.context.limit)}</span> limit
            </span>
          </div>

          {stats.context.modelMax > stats.context.limit && (
            <p className="text-[11px] text-foreground-secondary/50">
              Model supports {formatTokens(stats.context.modelMax)} — limit set to {formatTokens(stats.context.limit)} in config
            </p>
          )}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            icon={<Brain className="h-4 w-4" />}
            label="Thinking"
            value={stats.thinkingLevel || "off"}
          />
          <StatCard
            icon={<Minimize2 className="h-4 w-4" />}
            label="Compactions"
            value={String(stats.compactions)}
            highlight={stats.compactions > 0}
          />
          <StatCard
            label="Input tokens"
            value={stats.tokens.input.toLocaleString()}
          />
          <StatCard
            label="Output tokens"
            value={stats.tokens.output.toLocaleString()}
          />
        </div>

        {/* Compaction status */}
        {isCompacting && (
          <div className="flex items-center gap-2 text-sm text-yellow-500 py-2 px-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Context compaction in progress...</span>
          </div>
        )}

        {/* System prompt breakdown */}
        {stats.systemPrompt && (
          <div className="space-y-3 pt-3 border-t border-border">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-foreground-secondary" />
              System Prompt
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <MiniStat
                icon={<FolderOpen className="h-3.5 w-3.5" />}
                label="Project context"
                value={formatChars(stats.systemPrompt.projectContextChars)}
              />
              <MiniStat
                label="Non-project"
                value={formatChars(stats.systemPrompt.nonProjectContextChars)}
              />
              <MiniStat
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label="Skills"
                value={`${stats.systemPrompt.skills.count} (${formatChars(stats.systemPrompt.skills.promptChars)})`}
              />
              <MiniStat
                icon={<Wrench className="h-3.5 w-3.5" />}
                label="Tools"
                value={`${stats.systemPrompt.tools.count} (${formatChars(stats.systemPrompt.tools.schemaChars)})`}
              />
            </div>

            {/* Workspace files */}
            {stats.systemPrompt.workspaceFiles.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] text-foreground-secondary/60 uppercase tracking-wider font-medium">
                  Workspace Files
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {stats.systemPrompt.workspaceFiles.map((f) => (
                    <span
                      key={f.name}
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-surface-hover border border-border/50",
                        f.truncated && "border-yellow-500/40"
                      )}
                    >
                      <FileText className="h-2.5 w-2.5 text-foreground-secondary/60" />
                      <span className="font-medium">{f.name}</span>
                      <span className="text-foreground-secondary/50">
                        {formatChars(f.injectedChars)}
                      </span>
                      {f.truncated && (
                        <span className="text-yellow-500 text-[9px] font-medium">truncated</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {stats.updatedAt > 0 && (
          <p className="text-[11px] text-foreground-secondary/40 text-right pt-1">
            Session updated {timeAgo(stats.updatedAt)}
          </p>
        )}
      </div>
    </Dialog>
  );
}

// ============================================================================
// Small helper components
// ============================================================================

function StatCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg bg-surface-hover/50 border border-border/30">
      <span className="text-[11px] text-foreground-secondary flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span className={cn("text-sm font-medium", highlight && "text-yellow-500")}>
        {value}
      </span>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {icon && <span className="text-foreground-secondary/60">{icon}</span>}
      <span className="text-foreground-secondary">{label}</span>
      <span className="font-medium ml-auto">{value}</span>
    </div>
  );
}

// ============================================================================
// Keep the old export name for backwards compat (but it's now unused)
// ============================================================================

export function SessionStatsPanel(props: SessionStatsPanelProps) {
  return <SessionStatsIndicator {...props} />;
}
