import { scanProject } from './scanner/projectScanner';
import { scanRoutes } from './scanner/routeScanner';
import { analyzeHandler } from './analyzer/handlerAnalyzer';
import { buildFlows } from './builder/flowBuilder';
import { generateHtml, generateJson, generateMarkdown } from './generator';
import { Flow } from './types';

export interface JourneyMapOptions {
  rootPath: string;
  output?: string;
  format?: 'html' | 'json' | 'markdown';
  config?: any;
}

export async function generateJourneyMap(options: JourneyMapOptions): Promise<Flow[]> {
  // 1. Scan project
  const project = await scanProject({ rootPath: options.rootPath });

  // 2. Scan routes
  const routes = scanRoutes(project.sourceFiles);

  // 3. Analyze handlers
  const analyses = routes.map(route => analyzeHandler(route));

  // 4. Build flows
  const flows = buildFlows(routes, analyses, options.config);

  // 5. Generate output if specified
  if (options.output) {
    const outputPath = options.output;
    const format = options.format || 'html';

    switch (format) {
      case 'html':
        await generateHtml({ flows, outputPath: `${outputPath}/index.html` });
        break;
      case 'json':
        await generateJson(flows, `${outputPath}/flows.json`);
        break;
      case 'markdown':
        await generateMarkdown(flows, `${outputPath}/flows.md`);
        break;
    }
  }

  return flows;
}

export * from './types';