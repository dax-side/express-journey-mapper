# Changelog

All notable changes to express-journey-mapper will be documented in this file.

## [1.0.0] - 2025-12-06

### Added
- Initial release of Express Journey Mapper
- Automatic Express route discovery via AST parsing
- Handler function analysis with ts-morph
- User flow generation with intelligent path grouping
- Multiple output formats: HTML, JSON, Markdown
- Professional CLI with CliLogger and CliError classes
- Verbose and quiet modes for different output levels
- Duration tracking for performance visibility
- Error handling with actionable suggestions

### Fixed
- **TypeScript Type Safety** - Fixed critical type errors in handlerAnalyzer.ts
  - Added proper CallExpression type imports from ts-morph
  - Implemented type guards using `Node.isCallExpression()` before casting
  - Fixed `extractDescription()` to safely access CallExpression methods
  - Fixed `extractUrl()` to properly cast Node to CallExpression
  - Added try-catch error handling throughout analyzer
- **Route Detection** - Improved regex pattern to detect all Express HTTP methods
- **Template Path Resolution** - Fixed HTML template loading in ESM context

### Changed
- **Professional Output** - Removed ALL emoji characters from codebase
  - CLI uses minimal symbols: ✓ ✗ → •
  - HTML template uses ✓/✗ for success/error indicators
  - Markdown uses [SUCCESS]/[ERROR] text labels
  - Flow builder defaults to empty icon field
  - Error messages use professional formatting
- **Enhanced Handler Analysis**
  - Added `generateDescription()` for comprehensive handler summaries
  - Improved `extractRequestShape()` to detect body/query/params/headers
  - Enhanced `extractHttpMethod()` to support PATCH and config objects
  - Better `extractTableName()` supporting Prisma, MongoDB, Mongoose patterns
  - Added `inferTypeFromUsage()` for intelligent type detection
  - Improved error handling with graceful degradation

### Technical Improvements
- Strict TypeScript compilation with zero errors
- Proper type safety in AST node manipulation
- Enhanced error handling throughout codebase
- Better inline handler detection (arrow functions, function expressions)
- Comprehensive code documentation with JSDoc comments

### Known Issues
- Test app has implicit any types (cosmetic, doesn't affect production)
- Markdown files have linting warnings (formatting only, no functional impact)
- Package.json has "types" condition warning (doesn't affect functionality)

## Architecture

### Core Modules
1. **scanner/projectScanner.ts** - File discovery using glob patterns
2. **scanner/routeScanner.ts** - AST-based route detection with ts-morph
3. **analyzer/handlerAnalyzer.ts** - Handler function behavior analysis (REFACTORED)
4. **builder/flowBuilder.ts** - User flow generation and grouping (REFACTORED)
5. **generator/** - HTML/JSON/Markdown output generators (ALL REFACTORED)
6. **cli.ts** - Professional command-line interface (FULLY REFACTORED)

### Type System
- Route, HandlerAnalysis, Flow, FlowStep interfaces
- ExternalCall, SideEffect, Outcome types
- CliOptions for configuration

### Output Formats
- **HTML**: Single-file offline viewer with vanilla JavaScript
- **JSON**: Structured data for programmatic access
- **Markdown**: Text documentation with professional formatting

## Development

### Build
```bash
npm run build  # Generates CJS, ESM, and DTS files
```

### Usage
```bash
node dist/cli.js <path> --format <html|json|markdown> --output <dir> [--verbose|--quiet]
```

### Testing
```bash
# Standard output
node dist/cli.js test-app --output test-output --format html

# Verbose debug mode
node dist/cli.js test-app --output test-output --format json --verbose

# Quiet mode (errors only)
node dist/cli.js test-app --output test-output --format markdown --quiet
```

## Future Enhancements
- Comprehensive test suite (unit tests for all modules)
- Performance optimization (parallel AST parsing, result caching)
- Enhanced handler analysis (async/await patterns, middleware chains)
- Configuration file support (custom patterns, exclusions)
- WebSocket and GraphQL flow mapping
- Mermaid diagram generation
