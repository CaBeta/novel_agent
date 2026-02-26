import fs from "node:fs/promises";
import path from "node:path";
import { OUTPUT_DIR } from "../config/constants.js";

const DEFAULT_FILENAME_PATTERN = "chapter_{index}";

export class FileManager {
  private readonly outputDir: string;
  private readonly filenamePattern: string;

  constructor(
    outputDir: string = OUTPUT_DIR,
    filenamePattern: string = DEFAULT_FILENAME_PATTERN
  ) {
    this.outputDir = outputDir;
    this.filenamePattern = filenamePattern;
  }

  async ensureOutputDir(): Promise<void> {
    await fs.mkdir(this.outputDir, { recursive: true });
  }

  async saveChapter(index: number, content: string): Promise<string> {
    await this.ensureOutputDir();
    const filename = this.formatFilename(index);
    const filepath = path.join(this.outputDir, filename);
    await fs.writeFile(filepath, content, "utf-8");
    return filepath;
  }

  async getNextChapterIndex(): Promise<number> {
    await this.ensureOutputDir();
    const files = await fs.readdir(this.outputDir);
    const chapterFiles = files.filter((file) => file.endsWith(".md"));
    if (chapterFiles.length === 0) return 1;

    const indices = chapterFiles
      .map((file) => {
        const match = file.match(/(\d+)\.md$/);
        const rawIndex = match?.[1];
        if (!rawIndex) return 0;
        const parsed = Number.parseInt(rawIndex, 10);
        return Number.isNaN(parsed) ? 0 : parsed;
      })
      .filter((num) => Number.isFinite(num));

    if (indices.length === 0) return 1;
    return Math.max(...indices) + 1;
  }

  private formatFilename(index: number): string {
    const safeIndex = String(index).padStart(3, "0");
    const name = this.filenamePattern.replace("{index}", safeIndex);
    return `${name}.md`;
  }
}
