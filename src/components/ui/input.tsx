import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  error?: boolean;
  label?: string;
  startAddon?: ReactNode;
  endAddon?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", error, label, id, startAddon, endAddon, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
    const hasAddon = startAddon || endAddon;
    
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="form-label">
            {label}
          </label>
        )}
        {hasAddon ? (
          <div 
            className={cn(
              "flex items-center input-base",
              error && "error",
              "focus-within:border-[var(--input-focus)]"
            )}
          >
            {startAddon && (
              <span className="text-foreground-muted shrink-0 select-none">
                {startAddon}
              </span>
            )}
            <input
              id={inputId}
              type={type}
              className={cn(
                "flex-1 bg-transparent border-0 p-0 text-sm text-foreground placeholder:text-foreground-muted",
                "focus:outline-none focus:ring-0",
                startAddon && "pl-2",
                endAddon && "pr-2",
                className
              )}
              aria-invalid={error}
              ref={ref}
              {...props}
            />
            {endAddon && (
              <span className="text-foreground-muted shrink-0 select-none">
                {endAddon}
              </span>
            )}
          </div>
        ) : (
          <input
            id={inputId}
            type={type}
            className={cn(
              "input-base flex placeholder:text-foreground-muted",
              error && "error",
              className
            )}
            aria-invalid={error}
            ref={ref}
            {...props}
          />
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  label?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, label, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
    
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="form-label">
            {label}
          </label>
        )}
        <textarea
          id={inputId}
          className={cn(
            "input-base flex min-h-[100px] h-auto placeholder:text-foreground-muted resize-none",
            error && "error",
            className
          )}
          aria-invalid={error}
          ref={ref}
          {...props}
        />
      </div>
    );
  }
);

Textarea.displayName = "Textarea";

export { Input, Textarea };
