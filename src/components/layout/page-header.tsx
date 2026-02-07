import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  className?: string;
}

function PageHeader({ title, subtitle, className }: PageHeaderProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      {subtitle ? (
        <p className="text-sm text-foreground-secondary">{subtitle}</p>
      ) : null}
    </div>
  );
}

export { PageHeader };
