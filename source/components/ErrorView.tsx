import React from "react";
import { Box, Text, useInput } from "ink";
import { Layout } from "./Layout.js";

interface ErrorViewProps {
  message: string;
  onRetry: () => void;
}

export function ErrorView({ message, onRetry }: ErrorViewProps) {
  useInput((_input, key) => {
    if (key.return) onRetry();
  });

  return (
    <Layout title="生成失败" borderColor="red">
      <Text color="red" bold>
        生成失败
      </Text>
      <Text color="red">{message}</Text>
      <Box marginTop={1}>
        <Text color="cyan">按回车返回输入界面重试</Text>
      </Box>
    </Layout>
  );
}
