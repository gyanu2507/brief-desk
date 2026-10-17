"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useCopilotChatInternal } from "@copilotkit/react-core";
import type { MessagesProps } from "@copilotkit/react-ui";

type TranscriptState = {
  messages: unknown[];
  inProgress: boolean;
  updatedAt: number;
};

const TranscriptContext = createContext<TranscriptState>({
  messages: [],
  inProgress: false,
  updatedAt: 0,
});

export function useChatTranscript(): TranscriptState {
  return useContext(TranscriptContext);
}

export function TranscriptProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TranscriptState>({
    messages: [],
    inProgress: false,
    updatedAt: 0,
  });

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

  const value = useMemo(() => state, [state]);
  return <TranscriptContext.Provider value={value}>{children}</TranscriptContext.Provider>;
}

/**
 * Drop-in CopilotChat Messages renderer. Mirrors stock Messages (reads the live
 * agent via useCopilotChatInternal) and publishes that transcript for AgentLog.
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

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("brief-desk-transcript", {
        detail: {
          messages: visibleMessages ?? [],
          inProgress: Boolean(inProgress),
          updatedAt: Date.now(),
        } satisfies TranscriptState,
      }),
    );
  }, [visibleMessages, inProgress]);

  return (
    <div className="copilotKitMessages">
      <div className="copilotKitMessagesContainer">
        {visibleMessages.map((message, index) => (
          <RenderMessage
            key={message.id ?? index}
            message={message}
            messages={visibleMessages}
            inProgress={inProgress}
            index={index}
            isCurrentMessage={index === visibleMessages.length - 1}
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
        ))}
        {interrupt}
        {chatError && ErrorMessage ? (
          <ErrorMessage error={chatError} isCurrentMessage={true} />
        ) : null}
      </div>
      <footer className="copilotKitMessagesFooter">{children}</footer>
    </div>
  );
}
