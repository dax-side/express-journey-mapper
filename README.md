# Express Journey Mapper

> Production-grade CLI tool for automatically generating user journey documentation from Express.js codebases

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/yourusername/express-journey-mapper)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org)

## Overview

Express Journey Mapper analyzes your Express.js codebase using AST parsing to automatically discover routes, analyze handler behavior, and generate interactive documentation showing how users flow through your API endpoints.

**Key Benefits:**
- Save hours of manual documentation work
- Onboard new developers faster
- Keep API documentation always up-to-date
- Visualize complex user journeys
- Share flows with non-technical stakeholders

## Installation

```bash
# Global installation
npm install -g express-journey-mapper

# Local project installation
npm install --save-dev express-journey-mapper
```

## Quick Start

```bash
# Scan current directory and generate HTML documentation
npx express-journey-mapper

# Scan specific directory
npx express-journey-mapper ./src

# Generate JSON output
npx express-journey-mapper ./src --format json --output ./docs

# Verbose mode for debugging
npx express-journey-mapper --verbose
```

## Features

### Automatic Route Discovery
Scans your codebase to find all Express route definitions:
- `app.get/post/put/delete/patch`
- `router.get/post/put/delete/patch`
- Middleware detection
- Router mounting support

### Handler Analysis
Analyzes each route handler to understand:
- Request/response data shapes
- Success and error response paths
- External API calls (axios, fetch, etc.)
- Database operations (Prisma, Mongoose, TypeORM)
- Side effects (email, queues, caching)

### Flow Generation
Groups related routes into logical user journeys:
- Automatic grouping by path prefix (`/auth/*`, `/checkout/*`)
- Manual flow configuration via config file
- Step ordering based on redirects and common patterns

### Multiple Output Formats

#### HTML (Interactive Viewer)
- Single-file, offline-capable web application
- Zero external dependencies
- Sidebar navigation between flows
- Expandable step details
- Professional styling

#### JSON (Programmatic Access)
- Structured flow data
- Version information
- Machine-readable format
- Integration-ready

#### Markdown (Documentation)
- Text-based documentation
- README-ready format
- Version control friendly

## CLI Options

```bash
express-journey-mapper [path] [options]

Arguments:
  path                Project root path (default: ".")

Options:
  -o, --output <path>      Output directory (default: "./journey-map")
  -c, --config <path>      Config file path
  -f, --format <format>    Output format: html, json, markdown (default: "html")
  --no-auto-detect         Disable automatic flow detection
  -v, --verbose            Show detailed output
  -q, --quiet              Suppress non-error output
  -h, --help               Display help
  -V, --version            Display version
```

## Configuration

Create a `journey-map.config.js` file for advanced customization:

```javascript
export default {
  // Output settings
  output: './docs/api-flows',
  format: 'html',

  // Scanning options
  entryPoints: ['./src/app.ts', './src/server.ts'],
  exclude: ['**/*.test.ts', '**/*.spec.ts'],

  // Manual flow definitions (optional)
  flows: {
    authentication: {
      title: 'User Authentication Flow',
      description: 'Complete user authentication journey',
      steps: [
        {
          endpoint: 'POST /api/auth/register',
          description: 'User registration',
          successMessage: 'Account created successfully'
        },
        {
          endpoint: 'POST /api/auth/verify',
          description: 'Email verification',
          successMessage: 'Email verified'
        },
        {
          endpoint: 'POST /api/auth/login',
          description: 'User login',
          successMessage: 'Logged in successfully'
        }
      ]
    }
  }
};
```

## Programmatic API

```typescript
import { generateJourneyMap } from 'express-journey-mapper';

async function generateDocs() {
  const flows = await generateJourneyMap({
    rootPath: './src',
    output: './docs',
    format: 'html'
  });

  console.log(`Generated ${flows.length} user flows`);
}
```

## CLI Output Examples

### Standard Mode
```
Express Journey Mapper v1.0.0

Scanning project...
  Found 47 source files

Discovering routes...
  Found 23 routes

Analyzing handlers...
  Analyzed 23 handlers

Building user flows...
  Generated 3 flows:
  • Authentication Flow (3 steps)
  • Checkout Flow (4 steps)
  • Profile Management (2 steps)

Generating documentation...
  ✓ HTML: docs/index.html

Complete. Duration: 2.3s
```

### Verbose Mode
Includes detailed debug information about route discovery, handler analysis, and flow building.

### Quiet Mode
Suppresses all output except errors - ideal for CI/CD pipelines.

## Error Handling

The tool provides clear, actionable error messages:

```
✗ Error: No Express routes found

Suggestions:
  → Verify that your code uses standard Express patterns (app.get, app.post, etc.)
  → Check that route files are included in the scan path
  → Try specifying entry points in a config file: --config ./journey.config.js

Error code: NO_ROUTES_FOUND

Failed after 0.5s
```

## Requirements

- Node.js 16.0.0 or higher
- Express.js application with route definitions
- TypeScript or JavaScript source files

## Performance

| Project Size | Files | Routes | Analysis Time |
|--------------|-------|--------|---------------|
| Small        | <50   | <20    | <2 seconds   |
| Medium       | 50-200| 20-100 | <10 seconds  |
| Large        | 200-500| 100-300| <30 seconds |

## Troubleshooting

### No routes found
- Ensure your code uses standard Express patterns
- Check that route files are not excluded
- Try specifying `entryPoints` in config

### Handlers not analyzed correctly
- Verify handler functions are in the same file or properly imported
- Check for non-standard response patterns
- Use `--verbose` to see detailed analysis

### Performance issues
- Exclude test files and build outputs
- Use specific `entryPoints` instead of scanning entire project
- Consider using `--quiet` mode for CI/CD

## License

MIT

## Roadmap

- [ ] Support for Fastify, NestJS, Koa
- [ ] Watch mode for live updates
- [ ] VS Code extension
- [ ] Test generation
- [ ] Postman/Insomnia collection export
- [ ] GraphQL support
- [ ] WebSocket flow mapping