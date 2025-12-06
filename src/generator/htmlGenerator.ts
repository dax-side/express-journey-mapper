import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Flow } from '../types';

/**
 * Finds the package root by looking for package.json
 * Works in both development and installed contexts
 */
function findPackageRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  let currentDir = path.dirname(__filename);
  
  // Search up the directory tree for package.json
  while (currentDir !== path.dirname(currentDir)) {
    try {
      const packageJsonPath = path.join(currentDir, 'package.json');
      if (require('fs').existsSync(packageJsonPath)) {
        return currentDir;
      }
    } catch (error) {
      // Continue searching
    }
    currentDir = path.dirname(currentDir);
  }
  
  // Fallback: assume we're in dist/generator
  return path.resolve(path.dirname(__filename), '../..');
}

interface HtmlGeneratorOptions {
  flows: Flow[];
  outputPath: string;
  title?: string;
}

export async function generateHtml(options: HtmlGeneratorOptions): Promise<void> {
  // 1. Read template HTML from package directory
  const packageRoot = findPackageRoot();
  const templatePath = path.join(packageRoot, 'templates', 'viewer.html');
  const template = await fs.readFile(templatePath, 'utf-8');

  // 2. Embed flow data as JSON
  const dataScript = `
    <script>
      window.__JOURNEY_MAP_DATA__ = ${JSON.stringify(options.flows, null, 2)};
    </script>
  `;

  // 3. Inject into template
  const html = template.replace('<!-- DATA_PLACEHOLDER -->', dataScript);

  // 4. Ensure output directory exists
  const dir = path.dirname(options.outputPath);
  await fs.mkdir(dir, { recursive: true });

  // 5. Write to file
  await fs.writeFile(options.outputPath, html);
}