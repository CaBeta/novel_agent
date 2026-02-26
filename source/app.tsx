import React, { useCallback, useEffect, useState } from "react";
import { InputView } from "./components/InputView.js";
import { WritingView } from "./components/WritingView.js";
import { DoneView } from "./components/DoneView.js";
import { ErrorView } from "./components/ErrorView.js";
import { useNovelContext } from "./hooks/useNovelContext.js";
import { useStreamWriter } from "./hooks/useStreamWriter.js";
import { createLLMProvider } from "./services/llm/index.js";
import { FileManager } from "./services/file-manager.js";
import { buildWriterMessages } from "./config/prompts.js";
import { loadNovelConfig } from "./config/schema.js";
import type { AppStep } from "./types/index.js";

const config = loadNovelConfig();

function resolveApiKey(provider: string): string {
  if (provider === "deepseek") {
    const deepseekKey = process.env["DEEPSEEK_API_KEY"];
    if (!deepseekKey) {
      throw new Error("请在 .env 中设置 DEEPSEEK_API_KEY");
    }
    return deepseekKey;
  }

  const openaiKey = process.env["OPENAI_API_KEY"];
  if (!openaiKey) {
    throw new Error("请在 .env 中设置 OPENAI_API_KEY");
  }
  return openaiKey;
}

const apiKey = resolveApiKey(config.llm.provider);
const llmConfig = {
  model: config.llm.model,
  temperature: config.llm.temperature,
  maxTokens: config.llm.maxTokens,
  ...(config.llm.baseURL ? { baseURL: config.llm.baseURL } : {})
};
const llm = createLLMProvider(config.llm.provider, apiKey, llmConfig);
const fileManager = new FileManager(
  config.output.dir,
  config.output.filenamePattern
);

export default function App() {
  const [step, setStep] = useState<AppStep>("input");
  const [chapterIndex, setChapterIndex] = useState(1);
  const [savedPath, setSavedPath] = useState("");
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const { addChapter, buildContext } = useNovelContext();
  const writer = useStreamWriter(llm);

  useEffect(() => {
    let active = true;
    void fileManager
      .getNextChapterIndex()
      .then((nextIndex) => {
        if (active) setChapterIndex(nextIndex);
      })
      .catch((error) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "初始化失败";
        setRuntimeError(message);
        setStep("error");
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = useCallback(
    async (topic: string) => {
      setRuntimeError(null);
      setStep("writing");

      const context = buildContext();
      const messages = buildWriterMessages(topic, context);
      const result = await writer.start(messages);

      if (!result || !result.trim()) {
        setStep("error");
        setRuntimeError(writer.error ?? "模型未返回有效内容");
        return;
      }

      try {
        const filepath = await fileManager.saveChapter(chapterIndex, result);
        setSavedPath(filepath);
        addChapter({
          index: chapterIndex,
          title: topic,
          content: result,
          summary: result.slice(0, 200),
          createdAt: new Date().toISOString()
        });
        setStep("done");
      } catch (error) {
        const message = error instanceof Error ? error.message : "保存章节失败";
        setRuntimeError(message);
        setStep("error");
      }
    },
    [addChapter, buildContext, chapterIndex, writer]
  );

  const handleAbort = useCallback(() => {
    writer.abort();
    setStep("input");
  }, [writer]);

  const handleContinue = useCallback(() => {
    setRuntimeError(null);
    setChapterIndex((index) => index + 1);
    setStep("input");
  }, []);

  const handleRetry = useCallback(() => {
    setRuntimeError(null);
    setStep("input");
  }, []);

  switch (step) {
    case "input":
      return <InputView chapterIndex={chapterIndex} onSubmit={handleSubmit} />;
    case "writing":
      return (
        <WritingView
          content={writer.content}
          charCount={writer.charCount}
          onAbort={handleAbort}
        />
      );
    case "done":
      return (
        <DoneView
          filepath={savedPath}
          charCount={writer.charCount}
          onContinue={handleContinue}
        />
      );
    case "error":
      return (
        <ErrorView
          message={runtimeError ?? writer.error ?? "未知错误"}
          onRetry={handleRetry}
        />
      );
    default:
      return <ErrorView message="未知状态" onRetry={handleRetry} />;
  }
}
