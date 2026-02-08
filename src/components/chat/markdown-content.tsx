"use client";

import React, { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors text-white/60 hover:text-white/90"
      title={copied ? "Copied!" : "Copy code"}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * Renders markdown content with syntax highlighting for code blocks.
 * HTML rendering is disabled for XSS safety.
 */
export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none", className)}>
      <ReactMarkdown
        components={{
          // Code blocks with syntax highlighting
          code({ className: codeClassName, children, ...props }) {
            const match = /language-(\w+)/.exec(codeClassName || "");
            const codeString = String(children).replace(/\n$/, "");

            // Block code (with language tag)
            if (match) {
              return (
                <div className="relative group not-prose my-3">
                  <div className="flex items-center justify-between px-4 py-1.5 bg-[#1e1e2e] rounded-t-lg border-b border-white/10">
                    <span className="text-xs text-white/40 font-mono">{match[1]}</span>
                    <CopyButton text={codeString} />
                  </div>
                  <SyntaxHighlighter
                    style={oneDark}
                    language={match[1]}
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      borderTopLeftRadius: 0,
                      borderTopRightRadius: 0,
                      borderBottomLeftRadius: "0.5rem",
                      borderBottomRightRadius: "0.5rem",
                      fontSize: "0.8125rem",
                      lineHeight: "1.5",
                    }}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              );
            }

            // Multi-line code without language
            if (codeString.includes("\n")) {
              return (
                <div className="relative group not-prose my-3">
                  <CopyButton text={codeString} />
                  <SyntaxHighlighter
                    style={oneDark}
                    PreTag="div"
                    customStyle={{
                      borderRadius: "0.5rem",
                      fontSize: "0.8125rem",
                      lineHeight: "1.5",
                    }}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              );
            }

            // Inline code
            return (
              <code
                className="px-1.5 py-0.5 rounded bg-surface-hover font-mono text-[0.8125rem]"
                {...props}
              >
                {children}
              </code>
            );
          },

          // Links
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {children}
              </a>
            );
          },

          // Tables
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3 not-prose">
                <table className="min-w-full text-sm border-collapse">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="px-3 py-2 text-left text-xs font-medium text-foreground-secondary border-b border-border bg-surface-hover">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-3 py-2 text-sm border-b border-border/50">
                {children}
              </td>
            );
          },

          // Blockquotes
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-accent/50 pl-4 my-3 text-foreground-secondary italic">
                {children}
              </blockquote>
            );
          },

          // Lists
          ul({ children }) {
            return <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>;
          },

          // Horizontal rule
          hr() {
            return <hr className="my-4 border-border" />;
          },

          // Paragraphs
          p({ children }) {
            return <p className="my-1.5 leading-relaxed">{children}</p>;
          },

          // Headings
          h1({ children }) {
            return <h1 className="text-lg font-bold mt-4 mb-2">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-base font-bold mt-3 mb-1.5">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
