import React from "react";
import { Text } from "ink";
import Spinner from "ink-spinner";
import { Layout } from "./Layout.js";

interface LoadingViewProps {
  message: string;
}

export function LoadingView({ message }: LoadingViewProps) {
  return (
    <Layout title="初始化中" borderColor="yellow">
      <Text color="yellow">
        <Spinner type="dots" /> {message}
      </Text>
    </Layout>
  );
}
