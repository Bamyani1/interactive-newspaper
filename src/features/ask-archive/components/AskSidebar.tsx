"use client";

import React from "react";
import { Plus, Eraser, Download } from "lucide-react";
import type { ThreadSummary } from "../hooks/askReducer";
import { ThreadList } from "./ThreadList";

interface AskSidebarProps {
  threads: ThreadSummary[];
  activeThreadId: string | null;
  onNewConversation: () => void;
  onClearAllThreads: () => void;
  onExportConversation: () => void;
  onSwitchThread: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => void;
  onRequestDeleteThread: (thread: ThreadSummary) => void;
  canNewConversation: boolean;
  canClearAllThreads: boolean;
  canExportConversation: boolean;
}

export const AskSidebar: React.FC<AskSidebarProps> = ({
  threads,
  activeThreadId,
  onNewConversation,
  onClearAllThreads,
  onExportConversation,
  onSwitchThread,
  onRenameThread,
  onRequestDeleteThread,
  canNewConversation,
  canClearAllThreads,
  canExportConversation,
}) => {
  return (
    <aside className="ask-sidebar">
      <div className="ask-sidebar-title">
        {/* h2, not h1: the reading column owns the page's h1, and two of
            them left assistive tech with no single document title. */}
        <h2 className="ask-sidebar-heading">Ask the Archive</h2>
      </div>

      <div className="ask-sidebar-actions">
        <button
          type="button"
          className="ask-sidebar-newbtn"
          onClick={onNewConversation}
          disabled={!canNewConversation}
          aria-label="Start a new conversation"
        >
          <span className="ask-sidebar-newbtn-label">
            <Plus size={12} aria-hidden="true" />
            <span>New conversation</span>
          </span>
          <span className="ask-sidebar-newbtn-plus" aria-hidden="true">
            +
          </span>
        </button>
        <button
          type="button"
          className="ask-sidebar-newbtn"
          onClick={onExportConversation}
          disabled={!canExportConversation}
          aria-label="Export the conversation as a PDF"
        >
          <span className="ask-sidebar-newbtn-label">
            <Download size={12} aria-hidden="true" />
            <span>Export as PDF</span>
          </span>
          <span className="ask-sidebar-newbtn-plus" aria-hidden="true">
            ↓
          </span>
        </button>
      </div>

      <section className="ask-sidebar-section">
        <header className="ask-sidebar-section-label">
          <span>Threads</span>
          <span>{threads.length}</span>
        </header>
        <div className="ask-sidebar-threads">
          <ThreadList
            threads={threads}
            activeThreadId={activeThreadId}
            onSwitchThread={onSwitchThread}
            onRenameThread={onRenameThread}
            onRequestDelete={onRequestDeleteThread}
          />
        </div>
      </section>

      <div className="ask-sidebar-footer">
        <button
          type="button"
          className="ask-sidebar-newbtn"
          onClick={onClearAllThreads}
          disabled={!canClearAllThreads}
          aria-label="Clear all threads"
        >
          <span className="ask-sidebar-newbtn-label">
            <Eraser size={12} aria-hidden="true" />
            <span>Clear all threads</span>
          </span>
          <span className="ask-sidebar-newbtn-plus" aria-hidden="true">
            ×
          </span>
        </button>
      </div>
    </aside>
  );
};
