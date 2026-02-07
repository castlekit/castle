"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DialogProps extends HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  onClose?: () => void;
}

const Dialog = forwardRef<HTMLDivElement, DialogProps>(
  ({ className, open = false, onClose, children, ...props }, ref) => {
    if (!open) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
        <div
          className={cn(
            "relative z-50 w-full max-w-lg rounded-[var(--radius-lg)] bg-surface border border-border p-6 shadow-xl",
            className
          )}
          ref={ref}
          {...props}
        >
          {onClose && (
            <button
              onClick={onClose}
              className="absolute right-4 top-4 p-1 rounded-[var(--radius-sm)] text-foreground-muted hover:text-foreground hover:bg-surface-hover transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {children}
        </div>
      </div>
    );
  }
);

Dialog.displayName = "Dialog";

const DialogHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        className={cn("mb-4", className)}
        ref={ref}
        {...props}
      />
    );
  }
);

DialogHeader.displayName = "DialogHeader";

const DialogTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => {
  return (
    <h2
      className={cn("text-lg font-semibold text-foreground", className)}
      ref={ref}
      {...props}
    />
  );
});

DialogTitle.displayName = "DialogTitle";

const DialogDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => {
  return (
    <p
      className={cn("text-sm text-foreground-secondary mt-1", className)}
      ref={ref}
      {...props}
    />
  );
});

DialogDescription.displayName = "DialogDescription";

const DialogFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        className={cn("flex justify-end gap-3 mt-6", className)}
        ref={ref}
        {...props}
      />
    );
  }
);

DialogFooter.displayName = "DialogFooter";

export { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter };
