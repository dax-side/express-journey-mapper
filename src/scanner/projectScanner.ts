import { glob } from 'glob';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ProjectScannerOptions, ScannedProject } from '../types';

/** Default directories to exclude from scanning */
const DEFAULT_EXCLUDES = [
  'node_modules/**',
  'dist/**',
  'build/**',
  'out/**',
  '.git/**',
  'coverage/**',
  '.next/**',
  '.nuxt/**',
  '__tests__/**',
  '**/*.test.ts',
  '**/*.test.js',
  '**/*.spec.ts',
  '**/*.spec.js',
  '**/*.d.ts'
];

export async function scanProject(options: ProjectScannerOptions): Promise<ScannedProject> {
  // Validate root path exists
  try {
    const stat = await fs.stat(options.rootPath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${options.rootPath}`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Directory not found: ${options.rootPath}`);
    }
    throw e;
  }

  // Build exclusion patterns - use ignore option instead of negation patterns
  const ignorePatterns = [
    ...DEFAULT_EXCLUDES,
    ...(options.exclude || [])
  ];

  // Find all .ts and .js files
  const patterns = [
    '**/*.ts',
    '**/*.js',
    '**/*.mts',
    '**/*.mjs'
  ];

  const files = await glob(patterns, { 
    cwd: options.rootPath,
    nodir: true,  // Only match files, not directories
    absolute: false,
    ignore: ignorePatterns  // Use ignore option for exclusions
  });

  if (files.length === 0) {
    throw new Error(`No source files found in ${options.rootPath}`);
  }

  // Convert to absolute paths
  const absoluteFiles = files.map(f => path.join(options.rootPath, f));

  // Find entry point (file that creates Express app)
  const entryPoint = options.entryPoints?.[0] || await findEntryPoint(absoluteFiles);

  return {
    sourceFiles: absoluteFiles,
    entryPoint
  };
}

async function findEntryPoint(files: string[]): Promise<string> {
  // Priority order for common Express entry files
  const commonNames = [
    'app.ts', 'app.js',
    'server.ts', 'server.js',
    'index.ts', 'index.js',
    'main.ts', 'main.js',
    'src/app.ts', 'src/app.js',
    'src/server.ts', 'src/server.js',
    'src/index.ts', 'src/index.js'
  ];

  // First, try to find by common name patterns
  for (const name of commonNames) {
    const candidate = files.find(f => f.endsWith(name) || path.basename(f) === name);
    if (candidate) {
      try {
        const content = await fs.readFile(candidate, 'utf-8');
        if (containsExpressInit(content)) {
          return candidate;
        }
      } catch (e) {
        // Skip unreadable files
      }
    }
  }

  // Fallback: check all files for express initialization
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      if (containsExpressInit(content)) {
        return file;
      }
    } catch (e) {
      // Skip unreadable files
    }
  }

  // Default to first file if nothing found
  return files[0] || '';
}

/**
 * Checks if file content contains Express app initialization
 */
function containsExpressInit(content: string): boolean {
  return (
    content.includes('express()') ||
    content.includes("require('express')") ||
    content.includes('require("express")') ||
    content.includes("from 'express'") ||
    content.includes('from "express"')
  );
}