import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Flow } from '../types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface HtmlGeneratorOptions {
  flows: Flow[];
  outputPath: string;
  title?: string;
}

export async function generateHtml(options: HtmlGeneratorOptions): Promise<void> {
  // 1. Read template HTML from package directory
  // __dirname points to dist/generator, so go up two levels to reach templates/
  const templatePath = path.resolve(__dirname, '../../templates/viewer.html');
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