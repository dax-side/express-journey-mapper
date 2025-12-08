#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { scanProject } from './scanner/projectScanner';
import { scanRoutes } from './scanner/routeScanner';
import { analyzeHandler, setProjectRoot } from './analyzer/handlerAnalyzer';
import { buildFlows } from './builder/flowBuilder';
import { generateHtml, generateJson, generateMarkdown, generateOpenAPI } from './generator';

interface CliOptions {
  output: string;
  config: string;
  format: 'html' | 'json' | 'markdown' | 'openapi';
  autoDetect: boolean;
  verbose: boolean;
  quiet: boolean;
}

class CliLogger {
  constructor(private verbose: boolean, private quiet: boolean) {}

  info(message: string): void {
    if (!this.quiet) {
      console.log(message);
    }
  }

  success(message: string): void {
    if (!this.quiet) {
      console.log(chalk.green(`  ${message}`));
    }
  }

  error(message: string, details?: string): void {
    console.error(chalk.red(`✗ Error: ${message}`));
    if (details) {
      console.error(chalk.gray(`  ${details}`));
    }
  }

  debug(message: string): void {
    if (this.verbose) {
      console.log(chalk.gray(`  [DEBUG] ${message}`));
    }
  }

  section(title: string): void {
    if (!this.quiet) {
      console.log(`\n${title}`);
    }
  }
}

class CliError extends Error {
  constructor(
    message: string,
    public readonly suggestions: string[] = [],
    public readonly code?: string
  ) {
    super(message);
    this.name = 'CliError';
  }
}

function validateOptions(options: CliOptions): void {
  const validFormats = ['html', 'json', 'markdown', 'openapi'];
  if (!validFormats.includes(options.format)) {
    throw new CliError(
      `Invalid format: ${options.format}`,
      [`Valid formats: ${validFormats.join(', ')}`],
      'INVALID_FORMAT'
    );
  }
  
  if (options.verbose && options.quiet) {
    throw new CliError(
      'Cannot use --verbose and --quiet together',
      ['Choose one mode or use neither for default output'],
      'CONFLICTING_OPTIONS'
    );
  }
}

const program = new Command();

program
  .name('express-journey-mapper')
  .description('Generate user journey documentation for Express.js applications')
  .version('1.0.0')
  .argument('[path]', 'Project root path', '.')
  .option('-o, --output <path>', 'Output directory', './journey-map')
  .option('-c, --config <path>', 'Config file path')
  .option('-f, --format <format>', 'Output format: html, json, markdown, or openapi', 'html')
  .option('--no-auto-detect', 'Disable automatic flow detection')
  .option('-v, --verbose', 'Show detailed output', false)
  .option('-q, --quiet', 'Suppress non-error output', false)
  .action(async (projectPath: string, options: CliOptions) => {
    const startTime = Date.now();
    const logger = new CliLogger(options.verbose, options.quiet);

    try {
      // Validate inputs
      validateOptions(options);
      
      const absolutePath = path.resolve(process.cwd(), projectPath);
      
      if (!options.quiet) {
        console.log('Express Journey Mapper v1.0.0\n');
      }

      // 1. Scan project
      logger.info('Scanning project...');
      logger.debug(`Root path: ${absolutePath}`);
      
      const project = await scanProject({ rootPath: absolutePath });
      
      if (project.sourceFiles.length === 0) {
        throw new CliError(
          'No source files found',
          [
            'Ensure the path contains TypeScript or JavaScript files',
            'Check that files are not excluded by default patterns',
            'Try specifying entry points via config file'
          ],
          'NO_SOURCE_FILES'
        );
      }
      
      logger.success(`Found ${project.sourceFiles.length} source files`);
      logger.debug(`Entry point: ${project.entryPoint}`);

      // 2. Scan routes
      logger.section('Discovering routes...');
      const routes = scanRoutes(project.sourceFiles);
      
      if (routes.length === 0) {
        throw new CliError(
          'No Express routes found',
          [
            'Verify that your code uses standard Express patterns (app.get, app.post, etc.)',
            'Check that route files are included in the scan path',
            'Try specifying entry points in a config file: --config ./journey.config.js'
          ],
          'NO_ROUTES_FOUND'
        );
      }
      
      logger.success(`Found ${routes.length} routes`);
      
      if (options.verbose) {
        routes.forEach(route => {
          logger.debug(`${route.method} ${route.path} -> ${route.handlerName}`);
        });
      }

      // 3. Analyze handlers
      logger.section('Analyzing handlers...');
      
      // Set project root for package.json-based service detection
      setProjectRoot(absolutePath);
      
      const analyses = routes.map(route => {
        logger.debug(`Analyzing ${route.method} ${route.path}`);
        return analyzeHandler(route);
      });
      logger.success(`Analyzed ${analyses.length} handlers`);

      // 4. Load config (if exists)
      let config = null;
      if (options.config) {
        try {
          logger.debug(`Loading config from ${options.config}`);
          config = await import(path.resolve(process.cwd(), options.config));
          logger.debug('Config loaded successfully');
        } catch (e) {
          logger.debug(`Config file not found or invalid: ${options.config}`);
        }
      }

      // 5. Build flows
      logger.section('Building user flows...');
      const flows = buildFlows(routes, analyses, config);
      
      if (flows.length === 0) {
        logger.success('No flows generated (no routes to group)');
      } else {
        logger.success(`Generated ${flows.length} flows:`);
        flows.forEach(flow => {
          logger.info(`  • ${flow.title} (${flow.steps.length} steps)`);
        });
      }

      // 6. Generate output
      logger.section('Generating documentation...');
      
      const outputPath = path.resolve(process.cwd(), options.output);
      let generatedFile: string;

      switch (options.format) {
        case 'html':
          generatedFile = path.join(outputPath, 'index.html');
          await generateHtml({ flows, outputPath: generatedFile });
          logger.success(`✓ HTML: ${path.relative(process.cwd(), generatedFile)}`);
          break;
        case 'json':
          generatedFile = path.join(outputPath, 'flows.json');
          await generateJson(flows, generatedFile);
          logger.success(`✓ JSON: ${path.relative(process.cwd(), generatedFile)}`);
          break;
        case 'markdown':
          generatedFile = path.join(outputPath, 'flows.md');
          await generateMarkdown(flows, generatedFile);
          logger.success(`✓ Markdown: ${path.relative(process.cwd(), generatedFile)}`);
          break;
        case 'openapi':
          generatedFile = path.join(outputPath, 'openapi.json');
          await generateOpenAPI(flows, generatedFile, {
            title: 'API Documentation',
            version: '1.0.0',
            description: 'Auto-generated API documentation'
          });
          logger.success(`✓ OpenAPI: ${path.relative(process.cwd(), generatedFile)}`);
          break;
        default:
          throw new CliError(
            `Invalid format: ${options.format}`,
            ['Valid formats are: html, json, markdown, openapi'],
            'INVALID_FORMAT'
          );
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      if (!options.quiet) {
        console.log(`\nComplete. Duration: ${duration}s`);
      }
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      if (error instanceof CliError) {
        logger.error(error.message);
        if (error.suggestions.length > 0) {
          console.error(chalk.yellow('\nSuggestions:'));
          error.suggestions.forEach(suggestion => {
            console.error(chalk.yellow(`  → ${suggestion}`));
          });
        }
        if (error.code) {
          console.error(chalk.gray(`\nError code: ${error.code}`));
        }
      } else if (error instanceof Error) {
        logger.error(error.message, error.stack?.split('\n').slice(0, 3).join('\n'));
      } else {
        logger.error(String(error));
      }
      
      console.error(chalk.gray(`\nFailed after ${duration}s`));
      process.exit(1);
    }
  });

program.parse();

export { CliError, CliLogger };