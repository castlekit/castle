import { cn } from "@/lib/utils";

interface CastleIconProps {
  className?: string;
}

export function CastleIcon({ className }: CastleIconProps) {
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("fill-current", className)}
    >
      <g>
        <path d="m124.809 408.11h262.382v103.89h-262.382z" />
        <path d="m273.162 123.55h134.646l-34.459-44.772 33.515-46.459h-133.702v-32.319h-29.985v196.446h29.985z" />
        <path d="m347.45 281.985h-50.335v-56.54h-79.107v56.54h-53.643v-56.54h-91.962v111.141c0 23.448 19.075 42.523 42.523 42.523h282.147c23.448 0 42.524-19.075 42.524-42.523v-111.14h-92.147z" />
      </g>
    </svg>
  );
}
