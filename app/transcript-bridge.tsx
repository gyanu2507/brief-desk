"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useCopilotChatInternal } from "@copilotkit/react-core";
import type { MessagesProps } from "@copilotkit/react-ui";
import { RestoredBrief } from "./RestoredBrief";

type TranscriptState = {
  messages: unknown[];
  inProgress: boolean;
  updatedAt: number;
};

type ProcessingState = {
  active: boolean;
  note: string | null;
};

/** History / refresh restore shown when CopilotKit's own thread is empty. */
export type PinnedThread = {
  id: string;
  user: string;
  assistant: string;
} | null;

type PinnedChatState = {
  pinned: PinnedThread;
  setPinned: (next: PinnedThread) => void;
};

const TranscriptContext = createContext<TranscriptState>({
  messages: [],
  inProgress: false,
  updatedAt: 0,
});

const PinnedChatContext = createContext<PinnedChatState>({
  pinned: null,
  setPinned: () => undefined,
});

export function useChatTranscript(): TranscriptState {
  return useContext(TranscriptContext);
}

export function usePinnedChat(): PinnedChatState {
  return useContext(PinnedChatContext);
}

const PIN_STORE_KEY = "brief-desk-pinned-chat";

function readPinnedStore(): PinnedThread {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PIN_STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PinnedThread;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id !== "string" || typeof parsed.assistant !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function TranscriptProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TranscriptState>({
    messages: [],
    inProgress: false,
    updatedAt: 0,
  });
  const [pinned, setPinnedState] = useState<PinnedThread>(null);
  const setPinned = useCallback((next: PinnedThread) => {
    setPinnedState(next);
    try {
      if (next) sessionStorage.setItem(PIN_STORE_KEY, JSON.stringify(next));
      else sessionStorage.removeItem(PIN_STORE_KEY);
    } catch {
      // ignore
    }
  }, []);

  // Hydrate pin after mount (and after React Strict Mode remounts).
  useEffect(() => {
    const stored = readPinnedStore();
    if (stored) setPinnedState(stored);
  }, []);

  useEffect(() => {
    const onSync = (ev: Event) => {
      const detail = (ev as CustomEvent<TranscriptState>).detail;
      if (!detail || !Array.isArray(detail.messages)) return;
      setState({
        messages: detail.messages,
        inProgress: Boolean(detail.inProgress),
        updatedAt: Date.now(),
      });
    };
    window.addEventListener("brief-desk-transcript", onSync);
    return () => window.removeEventListener("brief-desk-transcript", onSync);
  }, []);

  const transcriptValue = useMemo(() => state, [state]);
  const pinnedValue = useMemo(() => ({ pinned, setPinned }), [pinned, setPinned]);

  return (
    <TranscriptContext.Provider value={transcriptValue}>
      <PinnedChatContext.Provider value={pinnedValue}>{children}</PinnedChatContext.Provider>
    </TranscriptContext.Provider>
  );
}

function ProcessingBubble({ note }: { note: string }) {
  return (
    <div className="processing-bubble" role="status" aria-live="polite">
      <span className="processing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="processing-note">{note}</span>
    </div>
  );
}

function messageRole(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const role = (msg as { role?: string }).role;
  return typeof role === "string" ? role.toLowerCase() : "";
}

/**
 * Drop-in CopilotChat Messages renderer. Mirrors stock Messages for live turns,
 * and shows a solid RestoredBrief panel for History restore (no CopilotKit fade).
 */
export function LoggingMessages({
  inProgress,
  children,
  RenderMessage,
  AssistantMessage,
  UserMessage,
  ErrorMessage,
  ImageRenderer,
  onRegenerate,
  onCopy,
  onThumbsUp,
  onThumbsDown,
  messageFeedback,
  markdownTagRenderers,
  chatError,
}: MessagesProps) {
  const { messages: visibleMessages, interrupt } = useCopilotChatInternal();
  const { pinned, setPinned } = usePinnedChat();
  const [processing, setProcessing] = useState<ProcessingState>({
    active: false,
    note: null,
  });
  const endRef = useRef<HTMLDivElement>(null);

  const live = visibleMessages ?? [];
  const liveHasUser = live.some((m) => {
    const role = messageRole(m);
    return role === "user" || role === "human";
  });
  // Show restore whenever we have a pin and the user hasn't started a new chat.
  const showRestored = Boolean(pinned) && !liveHasUser;

  // Clear pin only after a real user message lands in CopilotKit (not inProgress flicker).
  useEffect(() => {
    if (!pinned || !liveHasUser) return;
    setPinned(null);
  }, [pinned, liveHasUser, setPinned]);

  useEffect(() => {
    const transcriptMsgs = showRestored && pinned
      ? [
          { id: `pin-u-${pinned.id}`, role: "user", content: pinned.user },
          { id: `pin-a-${pinned.id}`, role: "assistant", content: pinned.assistant },
        ]
      : live;
    window.dispatchEvent(
      new CustomEvent("brief-desk-transcript", {
        detail: {
          messages: transcriptMsgs,
          inProgress: Boolean(inProgress),
          updatedAt: Date.now(),
        } satisfies TranscriptState,
      }),
    );
  }, [showRestored, pinned, live, inProgress]);

  useEffect(() => {
    const onProcessing = (ev: Event) => {
      const detail = (ev as CustomEvent<ProcessingState>).detail;
      setProcessing({
        active: Boolean(detail?.active),
        note: typeof detail?.note === "string" ? detail.note : null,
      });
    };
    window.addEventListener("brief-desk-processing", onProcessing);
    return () => window.removeEventListener("brief-desk-processing", onProcessing);
  }, []);

  const showBubble = processing.active || Boolean(inProgress);
  const note =
    processing.note ||
    (inProgress ? "Agent thinking…" : "Working on your brief…");

  useEffect(() => {
    if (!showBubble) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [showBubble, note, live.length, showRestored]);

  return (
    <div className="copilotKitMessages">
      <div className="copilotKitMessagesContainer">
        {showRestored && pinned ? (
          <RestoredBrief user={pinned.user} assistant={pinned.assistant} />
        ) : (
          live.map((message, index) => (
            <RenderMessage
              key={(message as { id?: string }).id ?? index}
              message={message}
              messages={live}
              inProgress={inProgress}
              index={index}
              isCurrentMessage={index === live.length - 1}
              AssistantMessage={AssistantMessage}
              UserMessage={UserMessage}
              ImageRenderer={ImageRenderer}
              onRegenerate={onRegenerate}
              onCopy={onCopy}
              onThumbsUp={onThumbsUp}
              onThumbsDown={onThumbsDown}
              messageFeedback={messageFeedback}
              markdownTagRenderers={markdownTagRenderers}
            />
          ))
        )}
        {showBubble ? <ProcessingBubble note={note} /> : null}
        <div ref={endRef} />
        {interrupt}
        {chatError && ErrorMessage ? (
          <ErrorMessage error={chatError} isCurrentMessage={true} />
        ) : null}
      </div>
      <footer className="copilotKitMessagesFooter">{children}</footer>
    </div>
  );
}
