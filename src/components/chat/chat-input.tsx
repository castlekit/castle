"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, ImageIcon, X, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AgentMentionPopup, getFilteredAgents, type AgentInfo } from "./agent-mention-popup";

interface ChatInputProps {
  onSend: (content: string, agentId?: string) => Promise<void>;
  onAbort?: () => void;
  sending?: boolean;
  streaming?: boolean;
  disabled?: boolean;
  agents: AgentInfo[];
  defaultAgentId?: string;
  channelId?: string;
  className?: string;
  /** Called when user presses Shift+ArrowUp/Down to navigate between messages */
  onNavigate?: (direction: "up" | "down") => void;
}

export function ChatInput({
  onSend,
  onAbort,
  sending,
  streaming,
  disabled,
  agents,
  defaultAgentId,
  channelId,
  className,
  onNavigate,
}: ChatInputProps) {
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionHighlightIndex, setMentionHighlightIndex] = useState(0);
  const [isEmpty, setIsEmpty] = useState(true);

  const editorRef = useRef<HTMLDivElement>(null);

  // Get plain text content from editor
  const getPlainText = useCallback(() => {
    if (!editorRef.current) return "";
    return editorRef.current.innerText || "";
  }, []);

  // Get message content with mentions converted to IDs
  const getMessageContent = useCallback(() => {
    if (!editorRef.current) return { text: "", firstMentionId: undefined as string | undefined };

    let text = "";
    let firstMentionId: string | undefined;

    const processNode = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || "";
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        if (element.classList.contains("mention-chip")) {
          const agentId = element.dataset.agentId;
          if (agentId) {
            text += `@${agentId}`;
            if (!firstMentionId) firstMentionId = agentId;
          }
        } else if (element.tagName === "BR") {
          text += "\n";
        } else {
          element.childNodes.forEach(processNode);
        }
      }
    };

    editorRef.current.childNodes.forEach(processNode);
    return { text: text.trim(), firstMentionId };
  }, []);

  // Check for @mention trigger
  const checkForMentionTrigger = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const container = range.startContainer;

    if (container.nodeType !== Node.TEXT_NODE) {
      setShowMentions(false);
      return;
    }

    const text = container.textContent || "";
    const cursorPos = range.startOffset;
    const textBeforeCursor = text.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);

    if (mentionMatch) {
      const newFilter = mentionMatch[1].toLowerCase();
      if (newFilter !== mentionFilter) setMentionHighlightIndex(0);
      setMentionFilter(newFilter);
      setShowMentions(true);
    } else {
      setShowMentions(false);
      setMentionFilter("");
      setMentionHighlightIndex(0);
    }
  }, [mentionFilter]);

  // Handle input changes
  const handleInput = useCallback(() => {
    const text = getPlainText();
    setIsEmpty(!text.trim());
    checkForMentionTrigger();
  }, [getPlainText, checkForMentionTrigger]);

  // Insert mention chip
  const insertMention = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId);
      const displayName = agent?.name || agentId;

      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || !editorRef.current) return;

      const range = selection.getRangeAt(0);
      const container = range.startContainer;

      if (container.nodeType !== Node.TEXT_NODE) {
        setShowMentions(false);
        return;
      }

      const text = container.textContent || "";
      const cursorPos = range.startOffset;
      const textBeforeCursor = text.slice(0, cursorPos);
      const atIndex = textBeforeCursor.lastIndexOf("@");

      if (atIndex === -1) {
        setShowMentions(false);
        return;
      }

      const replaceRange = document.createRange();
      replaceRange.setStart(container, atIndex);
      replaceRange.setEnd(container, cursorPos);
      selection.removeAllRanges();
      selection.addRange(replaceRange);

      const chipHtml = `<span class="mention-chip inline-flex items-center px-1.5 py-0.5 rounded bg-accent/20 text-accent font-medium text-sm cursor-default" contenteditable="false" data-agent-id="${agentId}">@${displayName}</span>&nbsp;`;
      document.execCommand("insertHTML", false, chipHtml);

      setShowMentions(false);
      setMentionFilter("");
      setIsEmpty(false);
      editorRef.current.focus();
    },
    [agents]
  );

  // Handle paste (plain text only, with @mention chips)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData.getData("text/plain");
      if (text) {
        e.preventDefault();
        document.execCommand("insertText", false, text);
        setIsEmpty(false);
      }
    },
    []
  );

  // Handle submit
  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const { text, firstMentionId } = getMessageContent();
      if (!text || sending || streaming || disabled) return;

      const targetAgent = firstMentionId || defaultAgentId;

      if (editorRef.current) editorRef.current.innerHTML = "";
      setIsEmpty(true);

      await onSend(text, targetAgent);
    },
    [getMessageContent, sending, streaming, disabled, defaultAgentId, onSend]
  );

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Handle mention popup navigation
      if (showMentions) {
        const filteredAgents = getFilteredAgents(agents, mentionFilter);

        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionHighlightIndex((prev) =>
            prev < filteredAgents.length - 1 ? prev + 1 : 0
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionHighlightIndex((prev) =>
            prev > 0 ? prev - 1 : filteredAgents.length - 1
          );
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          if (filteredAgents.length > 0) {
            insertMention(filteredAgents[mentionHighlightIndex].id);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowMentions(false);
          return;
        }
      }

      // Shift+ArrowUp/Down — navigate between messages
      if (
        (e.key === "ArrowUp" || e.key === "ArrowDown") &&
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        onNavigate?.(e.key === "ArrowUp" ? "up" : "down");
        return;
      }

      // Regular Enter to send
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
        return;
      }

      if (e.key === "Escape") {
        setShowMentions(false);
        return;
      }
    },
    [handleSubmit, showMentions, agents, mentionFilter, mentionHighlightIndex, insertMention, onNavigate]
  );



  // Focus editor on channel change or when it becomes enabled
  useEffect(() => {
    if (!disabled) {
      editorRef.current?.focus();
    }
  }, [channelId, disabled]);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Input Area */}
      <form onSubmit={handleSubmit} className="relative">
        {/* @mention popup */}
        {showMentions && (
          <AgentMentionPopup
            agents={agents}
            filter={mentionFilter}
            onSelect={insertMention}
            onClose={() => setShowMentions(false)}
            highlightedIndex={mentionHighlightIndex}
          />
        )}

        <div className="flex items-end gap-3">
          <div className="flex-1 min-w-0 relative">
            {/* ContentEditable editor */}
            <div
              ref={editorRef}
              contentEditable={!disabled}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              data-placeholder="Message (Enter to send, Shift+Enter for new line, @ to mention)"
              className={cn(
                "w-full px-4 py-3 rounded-[var(--radius-sm)] bg-surface border border-border resize-none min-h-[48px] max-h-[200px] overflow-y-auto text-sm focus:outline-none focus:border-accent/50 break-words",
                "empty:before:content-[attr(data-placeholder)] empty:before:text-foreground-secondary/50 empty:before:pointer-events-none",
                (sending || streaming || disabled) && "opacity-50 pointer-events-none"
              )}
              role="textbox"
              aria-multiline="true"
              suppressContentEditableWarning
            />

          </div>

          {/* Stop / Send button */}
          {streaming ? (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={onAbort}
              className="h-12 w-12 rounded-[var(--radius-sm)] shrink-0"
              title="Stop response"
            >
              <Square className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={isEmpty || sending || streaming || disabled}
              className="h-12 w-12 rounded-[var(--radius-sm)] shrink-0"
            >
              {sending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
