import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { Layout } from "./Layout.js";
import type { NovelProjectMeta } from "../types/project.js";

interface ProjectSelectItem {
  label: string;
  value: string;
}

interface ProjectSetupViewProps {
  mode: "pick" | "create";
  projects: NovelProjectMeta[];
  errorMessage?: string | null;
  onSelectProject: (slug: string) => void;
  onRequestCreate: () => void;
  onCreateProject: (title: string) => void;
  onBack: () => void;
}

function formatProjectLabel(project: NovelProjectMeta): string {
  const chapterText =
    project.currentChapterIndex > 0
      ? `已写 ${project.currentChapterIndex} 章`
      : "尚未写章节";
  return `${project.title} (${project.slug}) · ${chapterText}`;
}

export function ProjectSetupView({
  mode,
  projects,
  errorMessage,
  onSelectProject,
  onRequestCreate,
  onCreateProject,
  onBack
}: ProjectSetupViewProps) {
  const [value, setValue] = useState("");

  useInput((_input, key) => {
    if (mode === "create" && projects.length > 0 && key.escape) {
      onBack();
    }
  });

  if (mode === "pick") {
    const items: ProjectSelectItem[] = projects
      .map((project) => ({
        label: formatProjectLabel(project),
        value: project.slug
      }))
      .concat({
        label: "创建新项目",
        value: "__create__"
      });

    return (
      <Layout title="选择项目" borderColor="blue">
        <Text>请选择要继续写作的项目：</Text>
        {errorMessage ? (
          <Box marginTop={1}>
            <Text color="red">{errorMessage}</Text>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === "__create__") {
                onRequestCreate();
                return;
              }
              onSelectProject(item.value);
            }}
          />
        </Box>
      </Layout>
    );
  }

  const handleSubmit = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    onCreateProject(trimmed);
    setValue("");
  };

  return (
    <Layout title="创建项目" borderColor="green">
      <Text>请输入小说项目名称：</Text>
      <Box marginTop={1}>
        <Text color="green">{"> "}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          placeholder="例如：赛博长安录"
          onSubmit={handleSubmit}
        />
      </Box>
      {projects.length > 0 ? (
        <Box marginTop={1}>
          <Text color="cyan">按 Esc 返回项目列表</Text>
        </Box>
      ) : null}
      {errorMessage ? (
        <Box marginTop={1}>
          <Text color="red">{errorMessage}</Text>
        </Box>
      ) : null}
    </Layout>
  );
}
