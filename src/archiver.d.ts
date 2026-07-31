/**
 * archiver@8 ships as pure ESM with no bundled type declarations, and the community
 * `@types/archiver` package still targets the old (v7 and earlier) callable-factory API.
 * This is a minimal ambient declaration covering only the surface this project uses.
 */
declare module "archiver" {
  import type { Transform } from "node:stream";

  export interface ZipArchiveOptions {
    zlib?: { level?: number };
  }

  export class ZipArchive extends Transform {
    constructor(options?: ZipArchiveOptions);
    file(filePath: string, data: { name: string }): this;
    finalize(): Promise<void>;
    pointer(): number;
  }
}
