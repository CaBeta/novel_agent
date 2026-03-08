import React, { useCallback, useEffect, useState } from "react";
import { InputView } from "./components/InputView.js";
import { WritingView } from "./components/WritingView.js";
import { DoneView } from "./components/DoneView.js";
import { ErrorView } from "./components/ErrorView.js";
import { LoadingView } from "./components/LoadingView.js";
import { ProjectSetupView } from "./components/ProjectSetupView.js";
import { useNovelContext } from "./hooks/useNovelContext.js";
import { useStreamWriter } from "./hooks/useStreamWriter.js";
import { createLLMProvider } from "./services/llm/index.js";
import type { LLMProvider } from "./services/llm/index.js";
import { MemoryExtractor } from "./services/memory/memory-extractor.js";
import { MemoryManager } from "./services/memory/memory-manager.js";
import { MemoryWriter, summarizeChapterContent } from "./services/memory/memory-writer.js";
import { FileManager } from "./services/file-manager.js";
import { createProjectManager } from "./services/project/project-manager.js";
import { resolveProjectPaths } from "./services/project/project-paths.js";
import { buildWriterMessages } from "./config/prompts.js";
import { loadNovelConfig } from "./config/schema.js";
import type { AppStep } from "./types/index.js";
import type {
  NovelProject,
  NovelProjectMeta,
  ProjectChapter,
  ProjectPaths
} from "./types/project.js";

interface RuntimeServices {
  config: ReturnType<typeof loadNovelConfig>;
  llm: LLMProvider;
  projectManager: ReturnType<typeof createProjectManager>;
}

interface RuntimeState {
  services: RuntimeServices | null;
  error: string | null;
}

const FALLBACK_LLM: LLMProvider = {
  async generateText(_messages, _signal) {
    throw new Error("LLM 初始化失败");
  },
  async *streamGenerate(_messages, _signal) {
    throw new Error("LLM 初始化失败");
  }
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

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

function initializeRuntime(): RuntimeState {
  try {
    const config = loadNovelConfig();
    const apiKey = resolveApiKey(config.llm.provider);
    const llmConfig = {
      model: config.llm.model,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
      ...(config.llm.baseURL ? { baseURL: config.llm.baseURL } : {})
    };

    return {
      services: {
        config,
        llm: createLLMProvider(config.llm.provider, apiKey, llmConfig),
        projectManager: createProjectManager(config.project.rootDir)
      },
      error: null
    };
  } catch (error) {
    return {
      services: null,
      error: getErrorMessage(error, "初始化失败")
    };
  }
}

export default function App() {
  const [runtime] = useState<RuntimeState>(initializeRuntime);
  const [step, setStep] = useState<AppStep>("loading");
  const [loadingMessage, setLoadingMessage] = useState("正在初始化...");
  const [setupMode, setSetupMode] = useState<"pick" | "create">("create");
  const [availableProjects, setAvailableProjects] = useState<NovelProjectMeta[]>(
    []
  );
  const [currentProject, setCurrentProject] = useState<NovelProject | null>(
    null
  );
  const [projectPaths, setProjectPaths] = useState<ProjectPaths | null>(null);
  const [memoryWriter, setMemoryWriter] = useState<MemoryWriter | null>(null);
  const [chapterIndex, setChapterIndex] = useState(1);
  const [savedPath, setSavedPath] = useState("");
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const { hydrateProject, buildContext } = useNovelContext();
  const writer = useStreamWriter(runtime.services?.llm ?? FALLBACK_LLM);

  const activateProject = useCallback(
    async (project: NovelProject) => {
      const services = runtime.services;
      if (!services) {
        throw new Error(runtime.error ?? "初始化失败");
      }

      const nextPaths = resolveProjectPaths(
        services.config.project.rootDir,
        project.slug
      );
      const fileManager = new FileManager(
        nextPaths.chaptersDir,
        services.config.output.filenamePattern
      );
      const nextMemoryManager = new MemoryManager(nextPaths);
      const memory = await nextMemoryManager.initialize(project);
      const nextChapterIndex = await fileManager.getNextChapterIndex();

      setCurrentProject(project);
      setProjectPaths(nextPaths);
      setMemoryWriter(
        new MemoryWriter(
          nextMemoryManager,
          new MemoryExtractor(services.llm)
        )
      );
      setChapterIndex(nextChapterIndex);
      setRuntimeError(null);
      hydrateProject({ outline: project.outline, memory });
    },
    [hydrateProject, runtime]
  );

  useEffect(() => {
    const services = runtime.services;
    if (!services) {
      setRuntimeError(runtime.error ?? "初始化失败");
      setStep("error");
      return;
    }

    let active = true;

    const bootstrap = async () => {
      setLoadingMessage("正在加载项目...");

      try {
        const projects = await services.projectManager.listProjects();
        if (!active) {
          return;
        }

        setAvailableProjects(projects);

        const currentProject = await services.projectManager.resolveInitialProject(
          services.config.project.autoLoadLastProject
        );

        if (!active) {
          return;
        }

        if (currentProject) {
          setLoadingMessage("正在恢复当前项目...");
          await activateProject(currentProject);
          if (active) {
            setStep("input");
          }
          return;
        }

        setSetupMode(projects.length > 0 ? "pick" : "create");
        setStep("project");
      } catch (error) {
        if (!active) {
          return;
        }

        setRuntimeError(getErrorMessage(error, "项目初始化失败"));
        setStep("error");
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, [activateProject, runtime]);

  const handleSelectProject = useCallback(
    async (slug: string) => {
      const services = runtime.services;
      if (!services) {
        return;
      }

      setLoadingMessage("正在打开项目...");
      setStep("loading");
      setRuntimeError(null);

      try {
        const project = await services.projectManager.openProject(slug);
        await activateProject(project);
        setStep("input");
      } catch (error) {
        setRuntimeError(getErrorMessage(error, "加载项目失败"));
        setStep("error");
      }
    },
    [activateProject, runtime]
  );

  const handleCreateProject = useCallback(
    async (title: string) => {
      const services = runtime.services;
      if (!services) {
        return;
      }

      setLoadingMessage("正在创建项目...");
      setStep("loading");
      setRuntimeError(null);

      try {
        const project = await services.projectManager.createProject({ title });
        const projects = await services.projectManager.listProjects();
        setAvailableProjects(projects);
        await activateProject(project);
        setStep("input");
      } catch (error) {
        setRuntimeError(getErrorMessage(error, "创建项目失败"));
        setStep("error");
      }
    },
    [activateProject, runtime]
  );

  const handleSubmit = useCallback(
    async (topic: string) => {
      const services = runtime.services;

      if (!services || !currentProject || !projectPaths || !memoryWriter) {
        setRuntimeError("当前项目未初始化完成");
        setStep("error");
        return;
      }

      setRuntimeError(null);
      setStep("writing");

      const context = buildContext(topic);
      const messages = buildWriterMessages(topic, context);
      const result = await writer.start(messages);

      if (result.aborted) {
        return;
      }

      if (!result.content || !result.content.trim()) {
        setRuntimeError(result.error ?? "模型未返回有效内容");
        setStep("error");
        return;
      }

      try {
        const fileManager = new FileManager(
          projectPaths.chaptersDir,
          services.config.output.filenamePattern
        );
        const filepath = await fileManager.saveChapter(
          chapterIndex,
          result.content
        );
        const chapter: ProjectChapter = {
          index: chapterIndex,
          title: topic,
          summary: summarizeChapterContent(result.content),
          filepath,
          charCount: Array.from(result.content).length,
          createdAt: new Date().toISOString()
        };
        const updatedProject = await services.projectManager.saveChapter(
          currentProject,
          chapter
        );
        const memoryUpdate = await memoryWriter.recordChapter({
          chapterIndex,
          title: topic,
          content: result.content,
          createdAt: chapter.createdAt,
          artifactsDir: projectPaths.artifactsDir
        });

        setSavedPath(filepath);
        setCurrentProject(updatedProject);
        hydrateProject({
          outline: updatedProject.outline,
          memory: memoryUpdate.memory
        });
        setStep("done");
      } catch (error) {
        setRuntimeError(getErrorMessage(error, "保存章节失败"));
        setStep("error");
      }
    },
    [
      buildContext,
      chapterIndex,
      currentProject,
      hydrateProject,
      memoryWriter,
      projectPaths,
      runtime,
      writer
    ]
  );

  const handleAbort = useCallback(() => {
    writer.abort();
    if (currentProject) {
      setStep("input");
    }
  }, [currentProject, writer]);

  const handleContinue = useCallback(() => {
    setRuntimeError(null);
    setChapterIndex((index) => index + 1);
    setStep("input");
  }, []);

  const handleRetry = useCallback(() => {
    setRuntimeError(null);

    if (!runtime.services) {
      setStep("error");
      return;
    }

    if (currentProject) {
      setStep("input");
      return;
    }

    setSetupMode(availableProjects.length > 0 ? "pick" : "create");
    setStep("project");
  }, [availableProjects.length, currentProject, runtime]);

  switch (step) {
    case "loading":
      return <LoadingView message={loadingMessage} />;
    case "project":
      return (
        <ProjectSetupView
          mode={setupMode}
          projects={availableProjects}
          errorMessage={runtimeError}
          onSelectProject={handleSelectProject}
          onRequestCreate={() => {
            setRuntimeError(null);
            setSetupMode("create");
          }}
          onCreateProject={handleCreateProject}
          onBack={() => {
            setRuntimeError(null);
            setSetupMode("pick");
          }}
        />
      );
    case "input":
      return currentProject ? (
        <InputView
          projectTitle={currentProject.title}
          chapterIndex={chapterIndex}
          onSubmit={handleSubmit}
        />
      ) : (
        <ErrorView message="当前项目未加载" onRetry={handleRetry} />
      );
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
