import { glob } from 'glob';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ProjectScannerOptions, ScannedProject } from '../types';

export async function scanProject(options: ProjectScannerOptions): Promise<ScannedProject> {
  // 1. Find all .ts and .js files
  const patterns = [
    '**/*.ts',
    '**/*.js',
    '!node_modules/**',
    '!dist/**',
    '!build/**',
    ...(options.exclude?.map(e => `!${e}`) || [])
  ];

  const files = await glob(patterns, { cwd: options.rootPath });

  // 2. Find entry point (file that creates Express app)
  const entryPoint = options.entryPoints?.[0] || await findEntryPoint(files.map(f => path.join(options.rootPath, f)));

  return {
    sourceFiles: files.map(f => path.join(options.rootPath, f)),
    entryPoint
  };
}

async function findEntryPoint(files: string[]): Promise<string> {
  // Look for common patterns: app.ts, server.ts, index.ts
  // Check file contents for express() initialization
  const commonNames = ['app.ts', 'server.ts', 'index.ts', 'main.ts'];

  for (const name of commonNames) {
    const candidate = files.find(f => path.basename(f) === name);
    if (candidate) {
      const content = await fs.readFile(candidate, 'utf-8');
      if (content.includes('express()') || content.includes('express(')) {
        return candidate;
      }
    }
  }

  // Fallback: check all files for express initialization
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      if (content.includes('express()') || content.includes('express(')) {
        return file;
      }
    } catch (e) {
      // Skip unreadable files
    }
  }

  // Default to first file if nothing found
  return files[0] || '';
}