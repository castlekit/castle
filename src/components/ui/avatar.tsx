import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
  status?: "online" | "offline" | "busy" | "away";
  statusPulse?: boolean;
}

const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, size = "md", status, statusPulse, children, ...props }, ref) => {
    return (
      <div className="relative inline-block shrink-0">
        <div
          className={cn(
            "relative flex shrink-0 overflow-hidden rounded-[4px] bg-surface border border-border",
            {
              "h-9 w-9": size === "sm",
              "h-10 w-10": size === "md",
              "h-12 w-12": size === "lg",
            },
            className
          )}
          ref={ref}
          {...props}
        >
          {children}
        </div>
        {status && (
          <span
            className={cn(
              "absolute block rounded-full ring-2 ring-background",
              {
                "h-2.5 w-2.5 -bottom-0.5 -right-0.5": size === "sm",
                "h-3 w-3 -bottom-0.5 -right-0.5": size === "md",
                "h-3.5 w-3.5 -bottom-0.5 -right-0.5": size === "lg",
              },
              {
                "bg-success": status === "online",
                "bg-foreground-muted": status === "offline",
                "bg-error": status === "busy",
                "bg-warning": status === "away",
              },
              statusPulse && "animate-pulse"
            )}
          />
        )}
      </div>
    );
  }
);

Avatar.displayName = "Avatar";

const AvatarImage = forwardRef<
  HTMLImageElement,
  React.ImgHTMLAttributes<HTMLImageElement>
>(({ className, alt, ...props }, ref) => {
  return (
    <img
      className={cn("aspect-square h-full w-full object-cover", className)}
      alt={alt}
      ref={ref}
      {...props}
    />
  );
});

AvatarImage.displayName = "AvatarImage";

const AvatarFallback = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => {
  return (
    <span
      className={cn(
        "flex h-full w-full items-center justify-center bg-surface text-foreground-secondary font-medium text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});

AvatarFallback.displayName = "AvatarFallback";

export { Avatar, AvatarImage, AvatarFallback };
