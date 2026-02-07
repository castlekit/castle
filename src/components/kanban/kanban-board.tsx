"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, MoreHorizontal } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { KanbanColumn } from "./kanban-column";
import { KanbanCard, type KanbanCardProps } from "./kanban-card";

export interface ColumnData {
  id: string;
  title: string;
  color?: string;
  cards: KanbanCardProps[];
}

export interface KanbanBoardProps {
  columns?: ColumnData[];
  className?: string;
  onCardMove?: (cardId: string, fromColumn: string, toColumn: string, newIndex: number) => void;
}

const defaultColumns: ColumnData[] = [
  {
    id: "captured",
    title: "Captured",
    color: "#a3a3a3",
    cards: [
      {
        id: "1",
        title: "Add voice commands to agents",
        description: "Explore options for voice input/output with agents",
        labels: ["feature"],
        priority: "low",
      },
      {
        id: "2",
        title: "Mobile app concept",
        description: "Think about mobile experience for Castle",
        labels: ["idea"],
      },
      {
        id: "3",
        title: "Agent memory persistence",
        labels: ["technical"],
      },
    ],
  },
  {
    id: "vibing",
    title: "Vibing",
    color: "#8b5cf6",
    cards: [
      {
        id: "4",
        title: "Chess coach agent",
        description: "Agent that helps improve chess game through analysis",
        labels: ["agent", "learning"],
        priority: "medium",
        assignee: { name: "Sage" },
      },
      {
        id: "5",
        title: "Crypto portfolio tracker",
        description: "Track Bitcoin and other crypto holdings",
        labels: ["app"],
        commentCount: 3,
      },
    ],
  },
  {
    id: "scoped",
    title: "Scoped",
    color: "#3b82f6",
    cards: [
      {
        id: "6",
        title: "The Armory - System Dashboard",
        description: "Dashboard showing API usage, Mac Mini health, agent stats",
        labels: ["castle", "priority"],
        priority: "high",
        assignee: { name: "Max" },
        commentCount: 5,
        attachmentCount: 2,
      },
    ],
  },
  {
    id: "in_development",
    title: "In Development",
    color: "#f59e0b",
    cards: [
      {
        id: "7",
        title: "Projects - Kanban Board",
        description: "Project management kanban for Castle app",
        labels: ["castle", "active"],
        priority: "urgent",
        assignee: { name: "Mason" },
        commentCount: 8,
      },
    ],
  },
  {
    id: "review",
    title: "Review",
    color: "#ec4899",
    cards: [],
  },
  {
    id: "live",
    title: "Live",
    color: "#22c55e",
    cards: [
      {
        id: "8",
        title: "Castle App Bootstrap",
        description: "Initial Next.js setup with Tailwind",
        labels: ["castle"],
        assignee: { name: "Mason" },
      },
      {
        id: "9",
        title: "Agent SOUL Architecture",
        description: "Modular identity system for agents",
        labels: ["documentation"],
      },
    ],
  },
];

function KanbanBoard({ columns: initialColumns = defaultColumns, className, onCardMove }: KanbanBoardProps) {
  const [columns, setColumns] = useState<ColumnData[]>(initialColumns);
  const [activeCard, setActiveCard] = useState<KanbanCardProps | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  
  const columnsRef = useRef(columns);
  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);
  
  const isProcessing = useRef(false);
  
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    for (const col of columnsRef.current) {
      const card = col.cards.find((c) => c.id === active.id);
      if (card) {
        setActiveCard(card);
        break;
      }
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    
    if (!over) {
      setOverColumnId(null);
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    const currentColumns = columnsRef.current;
    
    const findColByCard = (cardId: string) => 
      currentColumns.find((col) => col.cards.some((card) => card.id === cardId));
    const findColById = (colId: string) => 
      currentColumns.find((col) => col.id === colId);
    
    const activeCol = findColByCard(activeId);
    const overCol = findColByCard(overId) || findColById(overId);

    if (overCol) {
      setOverColumnId(overCol.id);
    }

    if (!activeCol || !overCol) return;
    if (activeId === overId) return;
    
    if (isProcessing.current) return;
    
    if (activeCol.id === overCol.id) return;
    
    const draggedCard = activeCol.cards.find((c) => c.id === activeId);
    if (!draggedCard) return;
    
    const overCardIndex = overCol.cards.findIndex((c) => c.id === overId);
    const insertIndex = overCardIndex >= 0 ? overCardIndex : overCol.cards.length;

    isProcessing.current = true;
    
    setColumns((prev) => {
      return prev.map((col) => {
        if (col.id === activeCol.id) {
          return { ...col, cards: col.cards.filter((c) => c.id !== activeId) };
        }
        if (col.id === overCol.id) {
          const newCards = [...col.cards];
          newCards.splice(insertIndex, 0, draggedCard);
          return { ...col, cards: newCards };
        }
        return col;
      });
    });
    
    requestAnimationFrame(() => {
      isProcessing.current = false;
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    
    setActiveCard(null);
    setOverColumnId(null);
    isProcessing.current = false;
    
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;
    if (activeId === overId) return;

    setColumns((prev) => {
      const findColByCard = (cardId: string) => 
        prev.find((col) => col.cards.some((card) => card.id === cardId));
      
      const activeCol = findColByCard(activeId);
      const overCol = findColByCard(overId);

      if (!activeCol || !overCol || activeCol.id !== overCol.id) return prev;

      const oldIndex = activeCol.cards.findIndex((c) => c.id === activeId);
      const newIndex = activeCol.cards.findIndex((c) => c.id === overId);
      
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return prev;
      
      return prev.map((col) => 
        col.id === activeCol.id 
          ? { ...col, cards: arrayMove(col.cards, oldIndex, newIndex) }
          : col
      );
    });
    
    if (onCardMove) {
      const currentColumns = columnsRef.current;
      for (const col of currentColumns) {
        const idx = col.cards.findIndex((c) => c.id === activeId);
        if (idx >= 0) {
          onCardMove(activeId, "", col.id, idx);
          break;
        }
      }
    }
  }

  if (!isMounted) {
    return (
      <div
        className={cn(
          "flex items-stretch gap-4 overflow-x-auto pb-4",
          className
        )}
      >
        {columns.map((column) => (
          <div
            key={column.id}
            className="flex flex-col min-w-[280px] max-w-[320px] bg-background-secondary rounded-[var(--radius-lg)] p-3 transition-colors"
          >
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                {column.color && (
                  <div
                    className="h-3 w-3 rounded-[var(--radius-full)]"
                    style={{ backgroundColor: column.color }}
                  />
                )}
                <h3 className="text-sm font-medium text-foreground">{column.title}</h3>
                <span className="text-xs text-foreground-muted bg-surface px-1.5 py-0.5 rounded-[var(--radius-sm)]">
                  {column.cards.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="p-1 rounded-[var(--radius-sm)] hover:bg-surface transition-colors cursor-pointer"
                  disabled
                >
                  <Plus className="h-4 w-4 text-foreground-muted" />
                </button>
                <button
                  className="p-1 rounded-[var(--radius-sm)] hover:bg-surface transition-colors cursor-pointer"
                  disabled
                >
                  <MoreHorizontal className="h-4 w-4 text-foreground-muted" />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2 flex-1 overflow-y-auto rounded-[var(--radius-md)] p-2 -m-1 border border-dashed border-transparent transition-colors">
              {column.cards.map((card) => (
                <KanbanCard key={card.id} {...card} />
              ))}
              {column.cards.length === 0 && (
                <div className="flex items-center justify-center h-20 text-sm text-foreground-muted">
                  No tasks
                </div>
              )}
            </div>

            <button
              className="flex items-center justify-center gap-2 mt-3 p-2 text-sm text-foreground-secondary hover:text-foreground hover:bg-surface rounded-[var(--radius-md)] transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Add task
            </button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div
        className={cn(
          "flex items-stretch gap-4 overflow-x-auto pb-4",
          className
        )}
      >
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            id={column.id}
            title={column.title}
            color={column.color}
            cards={column.cards}
            count={column.cards.length}
            isDropTarget={overColumnId === column.id}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeCard ? (
          <div className="shadow-xl rotate-2">
            <KanbanCard {...activeCard} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export { KanbanBoard };
