import React, { type PropsWithChildren } from "react";
import { Box, Text } from "ink";
import { APP_NAME } from "../config/constants.js";

interface LayoutProps extends PropsWithChildren {
  title: string;
  borderColor: "blue" | "yellow" | "green" | "red" | "gray";
}

export function Layout({ title, borderColor, children }: LayoutProps) {
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor={borderColor}>
      <Text bold>{`${APP_NAME} · ${title}`}</Text>
      <Box marginTop={1} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}
