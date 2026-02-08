"use client";

import { useRef, useEffect, memo } from "react";
import twemoji from "@twemoji/api";

interface TwemojiTextProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps children and replaces native Unicode emojis with Twemoji SVG images.
 * Uses twemoji.parse() on the rendered DOM node after mount/update.
 */
export const TwemojiText = memo(function TwemojiText({
  children,
  className,
}: TwemojiTextProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (ref.current) {
      twemoji.parse(ref.current, {
        folder: "svg",
        ext: ".svg",
        // Use jsDelivr CDN for the SVG assets
        base: "https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/",
      });
    }
  });

  return (
    <span ref={ref} className={className}>
      {children}
    </span>
  );
});
