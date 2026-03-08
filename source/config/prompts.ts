import type { Message } from "../types/index.js";

export const SYSTEM_PROMPT_WRITER = `你是一个专业的小说家。
要求：
- 文笔流畅，描写生动
- 保持与前文风格一致
- 注意人物性格的连贯性`;

export const SYSTEM_PROMPT_SUMMARY = `你是一个文本摘要专家。
请将给定的章节内容压缩为 200 字以内的摘要，保留关键情节和人物关系。`;

export const SYSTEM_PROMPT_MEMORY_EXTRACTOR = `你是一个小说记忆抽取器。
目标：从章节正文中抽取适合回写到长期记忆库的结构化信息。
要求：
- 只输出合法 JSON，不要输出解释
- 保守抽取，不确定就留空
- 角色、关系、设定、伏笔都以“可长期复用”为标准
- 不要编造正文中不存在的信息`;

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

export function buildMemoryExtractionMessages(input: {
  title: string;
  content: string;
  summary: string;
  candidateCharacters: string[];
  candidateRelations: Array<{
    from: string;
    to: string;
    status: string;
  }>;
  candidateWorldbook: string[];
  candidateForeshadowing: string[];
}): Message[] {
  const schemaHint = `{
  "characterUpdates": [
    {
      "name": "角色名",
      "currentStatus": "不超过60字",
      "latestSummary": "不超过80字",
      "aliases": ["可选别名"]
    }
  ],
  "relationUpdates": [
    {
      "fromName": "角色A",
      "toName": "角色B",
      "relationType": "allied|hostile|suspicious|protective|dependent|neutral",
      "currentStatus": "不超过60字"
    }
  ],
  "worldbookEntries": [
    {
      "title": "地点/组织/设定名",
      "content": "不超过80字",
      "tags": ["auto"]
    }
  ],
  "timeline": {
    "summary": "不超过120字",
    "participants": ["角色名"],
    "consequences": ["结果1"],
    "keywords": ["关键词1"]
  },
  "foreshadowing": {
    "open": [
      {
        "clue": "伏笔名",
        "notes": "不超过80字",
        "relatedCharacters": ["角色名"]
      }
    ],
    "resolve": [
      {
        "clue": "被回收的伏笔名",
        "notes": "不超过80字",
        "relatedCharacters": ["角色名"]
      }
    ]
  }
}`;

  return [
    { role: "system", content: SYSTEM_PROMPT_MEMORY_EXTRACTOR },
    {
      role: "user",
      content: `请根据下面章节内容抽取记忆更新 JSON。\n\n章节标题：${input.title}\n\n章节摘要：${input.summary}\n\n规则初筛结果：\n- 候选角色：${input.candidateCharacters.join("、") || "无"}\n- 候选关系：${
        input.candidateRelations.length > 0
          ? input.candidateRelations
              .map((item) => `${item.from}/${item.to}:${item.status}`)
              .join("；")
          : "无"
      }\n- 候选设定：${input.candidateWorldbook.join("、") || "无"}\n- 候选伏笔：${input.candidateForeshadowing.join("、") || "无"}\n\n章节正文：\n${input.content}\n\n只输出 JSON，格式严格遵循：\n${schemaHint}`
    }
  ];
}
