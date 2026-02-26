import React from "react";
import { Box, Text, useInput } from "ink";
import { Layout } from "./Layout.js";

interface DoneViewProps {
  filepath: string;
  charCount: number;
  onContinue: () => void;
}

export function DoneView({ filepath, charCount, onContinue }: DoneViewProps) {
  useInput((_input, key) => {
    if (key.return) onContinue();
  });

  return (
    <Layout title="写作完成" borderColor="green">
      <Text color="green" bold>
        本章已生成
      </Text>
      <Text>{`文件已保存: ${filepath}`}</Text>
      <Text color="gray">{`字数: ${charCount}`}</Text>
      <Box marginTop={1}>
        <Text color="cyan">按回车继续下一章，Ctrl+C 退出</Text>
      </Box>
    </Layout>
  );
}
