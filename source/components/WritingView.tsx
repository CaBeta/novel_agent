import React from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { Layout } from "./Layout.js";

interface WritingViewProps {
  content: string;
  charCount: number;
  onAbort: () => void;
}

export function WritingView({ content, charCount, onAbort }: WritingViewProps) {
  useInput((_input, key) => {
    if (key.escape) onAbort();
  });

  return (
    <Layout title="正在写作" borderColor="yellow">
      <Box marginBottom={1} justifyContent="space-between">
        <Text color="yellow">
          <Spinner type="dots" /> 正在生成...
        </Text>
        <Text color="gray">{charCount} 字</Text>
      </Box>
      <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={0}>
        <Text wrap="wrap">{content || "..."}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="cyan">按 Esc 取消，回到输入界面</Text>
      </Box>
    </Layout>
  );
}
