# Changelog

All notable changes to express-journey-mapper will be documented in this file.

## [1.0.6] - 2025-12-08

### Added - Deep Code Analysis & OpenAPI Export
This release transforms the tool from a basic route inventory to comprehensive API documentation generator.

#### Schema Extraction
- **Joi Validation Support** - Automatically extracts field definitions from Joi.object() schemas
  - Field names, types, required status
  - Validation rules: min, max, email, pattern, valid()
- **Zod Validation Support** - Parses z.object() schema definitions
  - Field names, types, optional detection
  - Validation rules: min, max, email, url, regex
- **express-validator Support** - Extracts validation chains
  - body(), param(), query() field detection
  - Validation rule extraction

#### Middleware Chain Visualization
- Detects and categorizes middleware types:
  - **Authentication**: authenticate, auth, jwt, passport, requireAuth
  - **Authorization**: authorize, requireRole, isAdmin, can, permit
  - **Validation**: validate, validateRequest, checkSchema
  - **Rate Limiting**: rateLimiter, rateLimit, throttle
- Shows complete middleware execution order per route

#### Service Dependency Mapping
- Detects service layer calls (ServiceName.methodName pattern)
- Tracks this.service.method() patterns
- Maps external dependencies:
  - Payment: Stripe, Paystack, Braintree
  - Email: SendGrid, Mailgun, AWS SES
  - Cloud Storage: AWS S3, Cloudinary
  - Databases: Prisma, MongoDB, TypeORM, Sequelize
  - Realtime: Socket.io events

#### OpenAPI 3.0 Export
- New `--format openapi` option generates OpenAPI 3.0 specification
- Automatic schema generation from validation definitions
- Path parameters converted to OpenAPI format (:id → {id})
- Query parameter documentation
- Request body schemas with field constraints
- Response schemas with status codes
- Security schemes (JWT Bearer authentication)
- Tags organized by flow/resource

#### Enhanced HTML Output
- **Authentication Section** - Shows auth requirements with JWT badge
- **Middleware Chain** - Step-by-step middleware visualization
- **Path Parameters** - Tabular display with types and examples
- **Query Parameters** - Shows optional/required status
- **Request Body** - Field details with type, required, constraints
- **Response Bodies** - Organized by status code
- **Service Calls** - Lists all service layer interactions
- **External Dependencies** - Payment, email, storage services
- **Side Effects** - Email, socket, webhook, SMS notifications

### Fixed
- Handler matching for inline arrow functions (prevents wrong handler analysis)
- Schema extraction now correctly parses middleware arguments like validate(schema)
- Unique OpenAPI schema names per HTTP method (POST vs PUT)

### Technical Improvements
- New schemaExtractor.ts module (~600 lines) for deep code analysis
- Enhanced handlerAnalyzer.ts with comprehensive extraction
- New openapiGenerator.ts module (~540 lines) for OpenAPI export
- Improved FlowStep type with 15+ new fields

## [1.0.5] - 2025-12-06

### Added
- Support for chained route patterns: router.route('/path').get().post()

## [1.0.4] - 2025-12-06

### Fixed
- Modular router detection (Router.get() vs app.get())
- node_modules crash prevention
- Config file parsing improvements

## [1.0.0] - 2025-12-06

### Added
- Initial release of Express Journey Mapper
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
