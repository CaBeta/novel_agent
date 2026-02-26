import { useCallback, useEffect, useRef, useState } from "react";
import type { LLMProvider } from "../services/llm/index.js";
import type { Message } from "../types/index.js";

interface StreamWriterState {
  content: string;
  isWriting: boolean;
  error: string | null;
  charCount: number;
}

export function useStreamWriter(llm: LLMProvider) {
  const [state, setState] = useState<StreamWriterState>({
    content: "",
    isWriting: false,
    error: null,
    charCount: 0
  });
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(
    async (messages: Message[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ content: "", isWriting: true, error: null, charCount: 0 });

      try {
        let fullText = "";
        for await (const chunk of llm.streamGenerate(messages, controller.signal)) {
          if (controller.signal.aborted) break;
          fullText += chunk;
          setState((prev) => {
            const nextContent = prev.content + chunk;
            return {
              ...prev,
              content: nextContent,
              charCount: Array.from(nextContent).length
            };
          });
        }

        if (!controller.signal.aborted) {
          setState((prev) => ({ ...prev, isWriting: false }));
        }
        return fullText;
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : "未知错误";
          setState((prev) => ({
            ...prev,
            isWriting: false,
            error: message
          }));
        }
        return null;
      }
    },
    [llm]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, isWriting: false }));
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return { ...state, start, abort };
}
