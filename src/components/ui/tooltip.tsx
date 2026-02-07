"use client";

import { useState, useRef, useLayoutEffect, useEffect, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface TooltipProps {
  children: ReactNode;
  content: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

function Tooltip({ 
  children, 
  content, 
  side = "right",
  className 
}: TooltipProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isPositioned, setIsPositioned] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = useCallback(() => {
    if (triggerRef.current && tooltipRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const gap = 10;

      let x = 0;
      let y = 0;

      switch (side) {
        case "top":
          x = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
          y = triggerRect.top - tooltipRect.height - gap;
          break;
        case "bottom":
          x = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
          y = triggerRect.bottom + gap;
          break;
        case "left":
          x = triggerRect.left - tooltipRect.width - gap;
          y = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
          break;
        case "right":
        default:
          x = triggerRect.right + gap;
          y = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
          break;
      }

      setPosition({ x, y });
      setIsPositioned(true);
    }
  }, [side]);

  useLayoutEffect(() => {
    if (!isHovered) {
      setIsPositioned(false);
      return;
    }

    updatePosition();

    const onChange = () => updatePosition();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [isHovered, updatePosition]);

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={className}
      >
        {children}
      </div>
      {isHovered && mounted
        ? createPortal(
            <div
              ref={tooltipRef}
              className="fixed z-[9999] pointer-events-none"
              style={{
                left: position.x,
                top: position.y,
                visibility: isPositioned ? "visible" : "hidden",
              }}
            >
              <div
                className={cn(
                  "transition-all duration-150 ease-out",
                  isPositioned ? "opacity-100 scale-100" : "opacity-0 scale-95",
                  side === "right" && (isPositioned ? "translate-x-0" : "-translate-x-2"),
                  side === "left" && (isPositioned ? "translate-x-0" : "translate-x-2"),
                  side === "top" && (isPositioned ? "translate-y-0" : "translate-y-2"),
                  side === "bottom" && (isPositioned ? "translate-y-0" : "-translate-y-2")
                )}
              >
                <div className="relative bg-foreground text-background text-sm font-medium px-3 py-1.5 rounded-[4px] whitespace-nowrap shadow-xl shadow-black/25">
                  {content}
                  {side === "right" && (
                    <div className="absolute -left-[7px] top-1/2 -translate-y-1/2">
                      <div className="w-0 h-0 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-r-[8px] border-r-foreground" />
                    </div>
                  )}
                  {side === "left" && (
                    <div className="absolute -right-[7px] top-1/2 -translate-y-1/2">
                      <div className="w-0 h-0 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-l-[8px] border-l-foreground" />
                    </div>
                  )}
                  {side === "top" && (
                    <div className="absolute -bottom-[7px] left-1/2 -translate-x-1/2">
                      <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[8px] border-t-foreground" />
                    </div>
                  )}
                  {side === "bottom" && (
                    <div className="absolute -top-[7px] left-1/2 -translate-x-1/2">
                      <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[8px] border-b-foreground" />
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export { Tooltip };
