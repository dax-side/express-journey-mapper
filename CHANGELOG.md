# Changelog

All notable changes to express-journey-mapper will be documented in this file.

## [1.0.7] - 2025-12-08

### Fixed - Critical Analysis Accuracy Improvements

This release addresses 8 critical issues reported by users to eliminate false positives and improve detection accuracy.

#### Issue #1: Scope Bleeding - FIXED
- **Problem**: Analyzer was including ALL code in file scope (imports, middleware configs, utility functions)
- **Fix**: New call graph analyzer only examines handler function body
- **Result**: Health endpoints no longer show CORS config strings or payment services

#### Issue #2: String Literal Pollution - FIXED
- **Problem**: ALL string literals were being collected (error messages, config values)
- **Fix**: Only extract data from actual CallExpression nodes
- **Result**: No more false positives from string literals like "Blocked CORS request..."

#### Issue #3: No Call Graph - FIXED
- **Problem**: Imported but unused services were showing up in analysis
- **Fix**: Track actual function calls via CallExpression, not import statements
- **Result**: Paystack imported but not called in handler = no payment detection

#### Issue #4: Middleware Flagged as External Calls - FIXED
- **Problem**: `cors()`, `helmet()`, `authenticate()` were flagged as external operations
- **Fix**: Comprehensive middleware whitelist (40+ patterns including express, auth, validation)
- **Result**: Middleware is properly categorized, not flagged as external services

#### Issue #5: Validation Schema Extraction - VERIFIED
- Already implemented in v1.0.6 - confirmed working
- Joi, Zod, express-validator schemas properly extracted

#### Issue #6: No Confidence Scoring - IMPLEMENTED
- **Problem**: False positives treated same as certain detections
- **Fix**: All detections now have confidence scores (0.0-1.0)
- **Filter**: Only detections with confidence >= 0.6 are included
- **Result**: Low-confidence matches are filtered out

#### Issue #7: Hardcoded Service Patterns - FIXED
- **Problem**: Only detected hardcoded services (won't scale)
- **Fix**: Parse package.json dependencies to build service registry dynamically
- **Registry**: 40+ known packages (Stripe, Paystack, Flutterwave, Razorpay, SendGrid, Mailgun, S3, Cloudinary, Redis, etc.)
- **Result**: Auto-detects services from installed npm packages

#### Issue #8: Internal vs External HTTP Calls - FIXED
- **Problem**: `fetch('/api/internal')` flagged same as external APIs
- **Fix**: `isInternalUrl()` function filters:
  - Relative URLs (`/api/...`)
  - Localhost (`localhost`, `127.0.0.1`)
  - Internal Docker/K8s service names
- **Result**: Only truly external URLs are flagged

### Technical Changes

#### New Module: callGraphAnalyzer.ts (~600 lines)
- `analyzeHandlerCalls()` - Analyzes only handler body
- `getHandlerBody()` - Extracts function body from arrow/function expressions
- `isMiddlewareCall()` - Detects and filters middleware patterns
- `isInternalUrl()` - Distinguishes internal from external URLs
- `buildServiceRegistry()` - Dynamically builds service list from package.json
- `detectHttpCall()`, `detectDatabaseCall()`, `detectPaymentCall()`, etc.

#### Updated: handlerAnalyzer.ts
- Uses new call graph analyzer instead of text matching
- `setProjectRoot()` for package.json detection
- Confidence-based filtering for external calls and side effects
- Converted `DetectedCall` to `ExternalCall` with filtering

#### Updated Types
- `ExternalCall.type` expanded: added 'sms', 'cache', 'unknown'
- `SideEffect.type` expanded: added 'sms', 'analytics'

### Before/After Example

**Health Endpoint:**
```javascript
app.get('/health', cors(corsConfig), (req, res) => {
  res.json({ status: 'ok' });
});
```

**Before (v1.0.6):**
```json
{
  "externalCalls": ["Blocked CORS request from origin: ${origin}"],
  "paymentCalls": ["paystack.charge.create"]
}
```

**After (v1.0.7):**
```json
{
  "externalCalls": [],
  "sideEffects": [],
  "responses": [{ "statusCode": 200, "schema": "{ status: 'ok' }" }]
}
```

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
