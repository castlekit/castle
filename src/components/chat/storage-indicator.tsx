"use client";

import { useEffect, useState } from "react";
import { HardDrive, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface StorageData {
  messages: number;
  channels: number;
  attachments: number;
  totalAttachmentBytes: number;
  dbSizeBytes: number;
  attachmentsDirBytes: number;
  warnings: string[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

interface StorageIndicatorProps {
  className?: string;
}

export function StorageIndicator({ className }: StorageIndicatorProps) {
  const [data, setData] = useState<StorageData | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/openclaw/chat/storage");
        if (res.ok) {
          setData(await res.json());
        }
      } catch {
        // Silently fail — storage indicator is non-critical
      }
    }

    fetchStats();
    // Refresh every 5 minutes
    const interval = setInterval(fetchStats, 300000);
    return () => clearInterval(interval);
  }, []);

  if (!data) return null;

  const hasWarnings = data.warnings && data.warnings.length > 0;
  const totalSize = (data.dbSizeBytes || 0) + (data.attachmentsDirBytes || 0);

  return (
    <div className={cn("px-4 py-2 border-t border-border", className)}>
      <div className="flex items-center justify-between text-xs text-foreground-secondary">
        <div className="flex items-center gap-2">
          {hasWarnings ? (
            <AlertTriangle className="h-3 w-3 text-warning" />
          ) : (
            <HardDrive className="h-3 w-3" />
          )}
          <span>
            {data.messages.toLocaleString()} messages · {formatBytes(totalSize)}
          </span>
        </div>
        {hasWarnings && (
          <span className="text-warning text-xs truncate ml-2 max-w-[200px]" title={data.warnings.join("; ")}>
            {data.warnings[0]}
          </span>
        )}
      </div>
    </div>
  );
}
