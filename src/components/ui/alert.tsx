import { forwardRef, type HTMLAttributes } from "react";
import { AlertCircle, CheckCircle, Info, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "info" | "success" | "warning" | "error";
  dismissible?: boolean;
  onDismiss?: () => void;
}

const variantStyles = {
  info: {
    container: "bg-info/10 border-info/20 text-info",
    icon: Info,
  },
  success: {
    container: "bg-success/10 border-success/20 text-success",
    icon: CheckCircle,
  },
  warning: {
    container: "bg-warning/10 border-warning/20 text-warning",
    icon: AlertTriangle,
  },
  error: {
    container: "bg-error/10 border-error/20 text-error",
    icon: AlertCircle,
  },
};

const Alert = forwardRef<HTMLDivElement, AlertProps>(
  (
    {
      className,
      variant = "info",
      dismissible = false,
      onDismiss,
      children,
      ...props
    },
    ref
  ) => {
    const { container, icon: Icon } = variantStyles[variant];

    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-[var(--radius-md)] border p-4",
          container,
          className
        )}
        ref={ref}
        role="alert"
        {...props}
      >
        <Icon className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="flex-1 text-sm">{children}</div>
        {dismissible && onDismiss && (
          <button
            onClick={onDismiss}
            className="shrink-0 p-1 rounded-[var(--radius-sm)] hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }
);

Alert.displayName = "Alert";

export { Alert };
