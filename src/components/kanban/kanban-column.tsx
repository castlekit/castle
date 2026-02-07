"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { SortableCard, type KanbanCardProps } from "./kanban-card";

export interface KanbanColumnProps {
  id: string;
  title: string;
  count?: number;
  color?: string;
  cards?: KanbanCardProps[];
  className?: string;
  onAddCard?: () => void;
  isDropTarget?: boolean;
}

function KanbanColumn({
  id,
  title,
  count = 0,
  color,
  cards = [],
  className,
  onAddCard,
  isDropTarget = false,
}: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({
    id,
  });

  return (
    <div
      className={cn(
        "flex flex-col min-w-[280px] max-w-[320px] bg-background-secondary rounded-[var(--radius-lg)] p-3 transition-colors",
        className
      )}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          {color && (
            <div
              className="h-3 w-3 rounded-[var(--radius-full)]"
              style={{ backgroundColor: color }}
            />
          )}
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <span className="text-xs text-foreground-muted bg-surface px-1.5 py-0.5 rounded-[var(--radius-sm)]">
            {count}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded-[var(--radius-sm)] hover:bg-surface transition-colors cursor-pointer"
            onClick={onAddCard}
          >
            <Plus className="h-4 w-4 text-foreground-muted" />
          </button>
          <button className="p-1 rounded-[var(--radius-sm)] hover:bg-surface transition-colors cursor-pointer">
            <MoreHorizontal className="h-4 w-4 text-foreground-muted" />
          </button>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-col gap-2 flex-1 overflow-y-auto rounded-[var(--radius-md)] p-2 -m-1 border border-dashed border-transparent transition-colors",
          isDropTarget && "border-accent/50 bg-accent/10"
        )}
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <SortableCard key={card.id} {...card} />
          ))}
        </SortableContext>
        
        {cards.length === 0 && (
          <div className="flex items-center justify-center h-20 text-sm text-foreground-muted">
            No tasks
          </div>
        )}
      </div>

      <button
        className="flex items-center justify-center gap-2 mt-3 p-2 text-sm text-foreground-secondary hover:text-foreground hover:bg-surface rounded-[var(--radius-md)] transition-colors cursor-pointer"
        onClick={onAddCard}
      >
        <Plus className="h-4 w-4" />
        Add task
      </button>
    </div>
  );
}

export { KanbanColumn };
