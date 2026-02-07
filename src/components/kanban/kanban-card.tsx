"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MoreHorizontal, MessageSquare, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus =
  | "captured"
  | "vibing"
  | "scoped"
  | "ready"
  | "in_development"
  | "review"
  | "live";

export interface KanbanCardProps {
  id: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  assignee?: {
    name: string;
    avatar?: string;
  };
  labels?: string[];
  commentCount?: number;
  attachmentCount?: number;
  className?: string;
  onClick?: () => void;
}

function KanbanCard({
  title,
  description,
  assignee,
  labels = [],
  commentCount = 0,
  attachmentCount = 0,
  className,
  onClick,
}: KanbanCardProps) {
  return (
    <div
      className={cn(
        "group relative rounded-[var(--radius-md)] bg-surface border border-border p-4 transition-shadow cursor-pointer",
        "hover:border-border-hover hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20",
        className
      )}
      onClick={onClick}
    >
      <button
        className="absolute right-2 top-2 p-1 rounded-[var(--radius-sm)] opacity-0 group-hover:opacity-100 hover:bg-surface-hover transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <MoreHorizontal className="h-4 w-4 text-foreground-muted" />
      </button>

      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {labels.map((label) => (
            <Badge key={label} variant="outline" size="sm">
              {label}
            </Badge>
          ))}
        </div>
      )}

      <h4 className="text-sm font-medium text-foreground pr-6 mb-1">{title}</h4>

      {description && (
        <p className="text-xs text-foreground-secondary line-clamp-2 mb-3">
          {description}
        </p>
      )}

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
        <div className="flex items-center gap-3">
          {commentCount > 0 && (
            <div className="flex items-center gap-1 text-foreground-muted">
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="text-xs">{commentCount}</span>
            </div>
          )}
          {attachmentCount > 0 && (
            <div className="flex items-center gap-1 text-foreground-muted">
              <Paperclip className="h-3.5 w-3.5" />
              <span className="text-xs">{attachmentCount}</span>
            </div>
          )}
        </div>

        {assignee && (
          <div className="h-6 w-6 rounded-[var(--radius-full)] bg-surface-hover flex items-center justify-center text-xs font-medium text-foreground-secondary border border-border">
            {assignee.name[0]}
          </div>
        )}
      </div>
    </div>
  );
}

function SortableCard(props: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useSortable({ id: props.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "touch-none",
        isDragging && "z-50"
      )}
    >
      <KanbanCard {...props} />
    </div>
  );
}

export { KanbanCard, SortableCard };
