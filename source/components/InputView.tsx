import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { Layout } from "./Layout.js";

interface InputViewProps {
  projectTitle: string;
  chapterIndex: number;
  onSubmit: (value: string) => void;
}

export function InputView({
  projectTitle,
  chapterIndex,
  onSubmit
}: InputViewProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <Layout title={`第 ${chapterIndex} 章`} borderColor="blue">
      <Text color="gray">{`当前项目：${projectTitle}`}</Text>
      <Text>请输入本章剧情方向：</Text>
      <Box marginTop={1}>
        <Text color="green">{"> "}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          placeholder="描述这一章的情节方向..."
          onSubmit={handleSubmit}
        />
      </Box>
    </Layout>
  );
}
