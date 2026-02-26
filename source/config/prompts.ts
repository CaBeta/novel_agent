import type { Message } from "../types/index.js";

export const SYSTEM_PROMPT_WRITER = `你是一个专业的小说家。
要求：
- 文笔流畅，描写生动
- 保持与前文风格一致
- 注意人物性格的连贯性`;

export const SYSTEM_PROMPT_SUMMARY = `你是一个文本摘要专家。
请将给定的章节内容压缩为 200 字以内的摘要，保留关键情节和人物关系。`;

export function buildWriterMessages(topic: string, context: string): Message[] {
  return [
    { role: "system", content: SYSTEM_PROMPT_WRITER },
    {
      role: "user",
      content: context
        ? `已有背景：\n${context}\n\n请续写关于「${topic}」的情节。`
        : `请写一段关于「${topic}」的情节。`
    }
  ];
}
