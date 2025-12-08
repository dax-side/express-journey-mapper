import { Project, Node, SyntaxKind, SourceFile, CallExpression } from 'ts-morph';
import { Route, HandlerAnalysis, ExternalCall, SideEffect, Outcome, ResponseInfo } from '../types';
import { 
  extractValidationSchema, 
  analyzeMiddleware, 
  extractPathParams, 
  extractQueryParams,
  findServiceCalls,
  clearSchemaCache
} from './schemaExtractor';
import {
  analyzeHandlerCalls,
  clearDependencyCache,
  DetectedCall,
  DetectedSideEffect
} from './callGraphAnalyzer';
import * as path from 'path';
import * as fs from 'fs';

/** Project root for package.json detection */
let projectRoot: string | null = null;

/**
 * Sets the project root for package.json-based service detection
 */
export function setProjectRoot(root: string): void {
  projectRoot = root;
}

const DEFAULT_STATUS_CODE = 200;
const ERROR_THRESHOLD = 400;

/** Cache for source files to avoid re-parsing */
const sourceFileCache = new Map<string, SourceFile>();
let sharedProject: Project | null = null;

/**
 * Analyzes an Express route handler to extract behavior information
 * including request/response patterns, external calls, and side effects
 * 
 * FIXED (v1.0.7): Now uses call graph analysis to:
 * - Only analyze handler body, not entire file scope (Issue #1)
 * - Track actual call expressions, not string literals (Issue #2)
 * - Ignore middleware calls like cors, helmet (Issue #4)
 * - Use package.json for service detection (Issue #7)
 * - Distinguish internal vs external HTTP calls (Issue #8)
 */
export function analyzeHandler(route: Route): HandlerAnalysis {
  try {
    // Initialize shared project if needed
    if (!sharedProject) {
      sharedProject = new Project({ skipFileDependencyResolution: true });
    }

    const sourceFile = getSourceFile(route.handlerFile);
    if (!sourceFile) {
      return createDefaultAnalysis(route);
    }

    // Try to find the handler - it might be inline or imported
    let handler = findHandlerInFile(sourceFile, route.handlerName);
    
    // If not found locally, try to resolve import
    if (!handler && !isInlineHandler(route.handlerName)) {
      const resolved = resolveHandlerImport(sourceFile, route.handlerName);
      if (resolved) {
        handler = resolved;
      }
    }

    if (!handler) {
      return createDefaultAnalysis(route);
    }

    // Extract path parameters from URL pattern
    const pathParams = extractPathParams(route.path);
    
    // Extract query parameters from handler code
    const queryParams = extractQueryParams(handler);
    
    // Analyze middleware chain
    const middlewareChain = analyzeMiddleware(route.middleware);
    
    // Check if auth is required
    const authMiddleware = middlewareChain.find(m => m.type === 'auth');
    const authRequired = !!authMiddleware;
    
    // Try to extract validation schema from middleware
    const requestBody = extractValidationSchema(route.middleware, sourceFile);
    
    // Find service layer calls
    const serviceCalls = findServiceCalls(handler);
    
    // Extract all response information
    const responses = extractResponses(handler);
    
    // Use new call graph analyzer for proper scope-limited analysis
    // This fixes Issues #1, #2, #3, #4, #7, #8
    const root = projectRoot || path.dirname(route.handlerFile);
    const { calls: detectedCalls, sideEffects: detectedSideEffects } = analyzeHandlerCalls(handler, root);
    
    // Convert detected calls to ExternalCall format
    const externalCalls = convertDetectedCalls(detectedCalls);
    const sideEffects = convertDetectedSideEffects(detectedSideEffects);
    
    const analysis: HandlerAnalysis = {
      endpoint: `${route.method} ${route.path}`,
      description: generateDescription(route, handler, externalCalls, sideEffects),
      
      // New enhanced fields
      pathParams,
      queryParams,
      requestBody,
      responses,
      middlewareChain,
      authRequired,
      authDetails: authMiddleware?.details,
      serviceCalls,
      
      // External dependencies - now using call graph analysis
      externalCalls,
      sideEffects,
      
      // Legacy compat
      dataIn: extractRequestShape(handler),
      dataOut: extractResponseShape(handler),
      outcomes: findOutcomes(handler)
    };

    return analysis;
  } catch (error) {
    console.warn(`Warning: Failed to analyze handler for ${route.method} ${route.path}:`, error);
    return createDefaultAnalysis(route);
  }
}

/**
 * Converts DetectedCall array to ExternalCall array
 */
function convertDetectedCalls(detectedCalls: DetectedCall[]): ExternalCall[] {
  return detectedCalls
    .filter(call => !call.isInternal) // Filter out internal calls (Issue #8)
    .filter(call => call.confidence >= 0.6) // Filter low confidence (Issue #6)
    .map(call => ({
      type: call.type,
      target: call.target,
      method: call.method,
      service: call.service
    }));
}

/**
 * Converts DetectedSideEffect array to SideEffect array
 */
function convertDetectedSideEffects(detectedEffects: DetectedSideEffect[]): SideEffect[] {
  return detectedEffects
    .filter(effect => effect.confidence >= 0.6) // Filter low confidence
    .map(effect => ({
      type: effect.type,
      description: effect.description
    }));
}

/**
 * Clears the analyzer cache (call between scans)
 */
export function clearAnalyzerCache(): void {
  sourceFileCache.clear();
  clearSchemaCache();
  clearDependencyCache();
  sharedProject = null;
  projectRoot = null;
}

/**
 * Gets or creates a cached source file
 */
function getSourceFile(filePath: string): SourceFile | null {
  const absolutePath = path.resolve(filePath);
  
  if (sourceFileCache.has(absolutePath)) {
    return sourceFileCache.get(absolutePath)!;
  }

  if (!sharedProject) return null;
  
  try {
    if (!fs.existsSync(absolutePath)) {
      return null;
    }
    
    const sourceFile = sharedProject.addSourceFileAtPath(absolutePath);
    sourceFileCache.set(absolutePath, sourceFile);
    return sourceFile;
  } catch (e) {
    return null;
  }
}

/**
 * Checks if handler name looks like an inline function
 */
function isInlineHandler(handlerName: string): boolean {
  return handlerName.includes('=>') || 
         handlerName.includes('function') ||
         handlerName.includes('async');
}

/**
 * Finds a handler function within a source file
 */
function findHandlerInFile(sourceFile: SourceFile, handlerName: string): Node | null {
  // Handle inline arrow/function expressions
  if (isInlineHandler(handlerName)) {
    return findInlineHandler(sourceFile, handlerName);
  }

  // Clean up handler name (remove .bind(), trailing stuff)
  const cleanName = handlerName.split('.')[0].split('(')[0].trim();

  // Look for named function declarations
  const functions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
  for (const func of functions) {
    if (func.getName() === cleanName) {
      return func;
    }
  }

  // Look for variable declarations (const handler = ...)
  const variables = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
  for (const variable of variables) {
    if (variable.getName() === cleanName) {
      const initializer = variable.getInitializer();
      if (initializer) {
        return initializer;
      }
    }
  }

  // Look for exported functions
  const exportedDecls = sourceFile.getExportedDeclarations();
  const exported = exportedDecls.get(cleanName);
  if (exported && exported.length > 0) {
    return exported[0];
  }

  return null;
}

/**
 * Handles inline handler expressions
 */
function findInlineHandler(sourceFile: SourceFile, handlerName: string): Node | null {
  // Try to find an arrow function or function expression that matches
  const arrowFunctions = sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction);
  
  // Normalize the handler name for comparison
  const normalizedHandler = handlerName.replace(/\s+/g, ' ').trim();
  
  for (const arrow of arrowFunctions) {
    const text = arrow.getText().replace(/\s+/g, ' ').trim();
    // Match if either contains a significant portion of the other
    const handlerPrefix = normalizedHandler.substring(0, Math.min(100, normalizedHandler.length));
    const arrowPrefix = text.substring(0, Math.min(100, text.length));
    
    if (handlerPrefix === arrowPrefix || 
        normalizedHandler.includes(arrowPrefix) || 
        text.includes(handlerPrefix.substring(0, 60))) {
      return arrow;
    }
  }

  // Try function expressions
  const funcExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression);
  for (const func of funcExpressions) {
    const text = func.getText().replace(/\s+/g, ' ').trim();
    const normalizedFirst100 = normalizedHandler.substring(0, 100);
    if (text.includes(normalizedFirst100.substring(0, 60))) {
      return func;
    }
  }

  // No fallback - return null if no match found to avoid incorrect analysis
  return null;
}

/**
 * Resolves a handler import to find the actual function in another file
 */
function resolveHandlerImport(sourceFile: SourceFile, handlerName: string): Node | null {
  // Clean up handler name
  const cleanName = handlerName.split('.')[0].split('(')[0].trim();
  
  const importDeclarations = sourceFile.getImportDeclarations();

  for (const importDecl of importDeclarations) {
    // Check named imports: import { register } from './controllers/auth'
    const namedImports = importDecl.getNamedImports();
    for (const namedImport of namedImports) {
      const importName = namedImport.getAliasNode()?.getText() || namedImport.getName();
      if (importName === cleanName) {
        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        const resolvedPath = resolveModulePath(sourceFile.getFilePath(), moduleSpecifier);
        if (resolvedPath) {
          const importedFile = getSourceFile(resolvedPath);
          if (importedFile) {
            // Look for the original name (before alias)
            const originalName = namedImport.getName();
            return findHandlerInFile(importedFile, originalName);
          }
        }
      }
    }

    // Check default import
    const defaultImport = importDecl.getDefaultImport();
    if (defaultImport?.getText() === cleanName) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      const resolvedPath = resolveModulePath(sourceFile.getFilePath(), moduleSpecifier);
      if (resolvedPath) {
        const importedFile = getSourceFile(resolvedPath);
        if (importedFile) {
          // Find the default export
          const defaultExport = importedFile.getDefaultExportSymbol();
          if (defaultExport) {
            const declarations = defaultExport.getDeclarations();
            if (declarations.length > 0) {
              return declarations[0];
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Resolves a module path to an absolute file path
 */
function resolveModulePath(currentFile: string, moduleSpecifier: string): string | null {
  if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) {
    return null; // Skip node_modules
  }

  const dir = path.dirname(currentFile);
  let resolved = path.resolve(dir, moduleSpecifier);

  const extensions = ['.ts', '.js', '.mts', '.mjs', '/index.ts', '/index.js'];
  
  for (const ext of extensions) {
    const withExt = resolved + ext;
    if (fs.existsSync(withExt)) {
      return withExt;
    }
  }

  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (stat.isFile()) return resolved;
  }

  return null;
}

/**
 * Creates a minimal default analysis
 */
function createDefaultAnalysis(route: Route): HandlerAnalysis {
  const pathParams = extractPathParams(route.path);
  const middlewareChain = analyzeMiddleware(route.middleware);
  const authMiddleware = middlewareChain.find(m => m.type === 'auth');
  
  return {
    endpoint: `${route.method} ${route.path}`,
    description: `Handler for ${route.method} ${route.path}`,
    
    pathParams,
    queryParams: [],
    requestBody: null,
    responses: [{ statusCode: 200, description: 'Success response' }],
    middlewareChain,
    authRequired: !!authMiddleware,
    authDetails: authMiddleware?.details,
    serviceCalls: [],
    
    externalCalls: [],
    sideEffects: [],
    
    dataIn: '{}',
    dataOut: '{}',
    outcomes: [{
      type: 'success',
      statusCode: 200,
      description: 'Success response'
    }]
  };
}

/**
 * Extracts all response information from handler (status codes, schemas, examples)
 */
function extractResponses(handler: Node): ResponseInfo[] {
  const responses: ResponseInfo[] = [];
  const seenStatusCodes = new Set<number>();
  
  const calls = handler.getDescendantsOfKind(SyntaxKind.CallExpression);
  
  for (const call of calls) {
    const expr = call.getExpression().getText();
    
    // Look for res.status(code).json({...})
    if (expr.includes('.status')) {
      const statusMatch = call.getText().match(/\.status\((\d+)\)/);
      if (statusMatch) {
        const statusCode = parseInt(statusMatch[1], 10);
        if (!seenStatusCodes.has(statusCode)) {
          seenStatusCodes.add(statusCode);
          
          const schema = extractResponseSchemaFromChain(call);
          responses.push({
            statusCode,
            description: getStatusDescription(statusCode),
            schema,
            example: extractResponseExample(call)
          });
        }
      }
    }
    
    // Look for direct res.json() or res.send() (defaults to 200)
    if ((expr === 'res.json' || expr === 'res.send') && !seenStatusCodes.has(200)) {
      seenStatusCodes.add(200);
      const args = call.getArguments();
      responses.push({
        statusCode: 200,
        description: 'Success',
        schema: args.length > 0 ? formatResponseShape(args[0].getText()) : undefined,
        example: args.length > 0 ? args[0].getText() : undefined
      });
    }
  }
  
  // Add default 200 if no responses found
  if (responses.length === 0) {
    responses.push({
      statusCode: 200,
      description: 'Success response'
    });
  }
  
  // Sort by status code
  responses.sort((a, b) => a.statusCode - b.statusCode);
  
  return responses;
}

/**
 * Extracts response schema from a chained call
 */
function extractResponseSchemaFromChain(statusCall: CallExpression): string | undefined {
  // Look for .json() or .send() chained after status
  const parent = statusCall.getParent();
  if (!parent) return undefined;
  
  const parentText = parent.getText();
  
  // Try to find the json/send call in the chain
  if (Node.isPropertyAccessExpression(parent)) {
    const grandparent = parent.getParent();
    if (grandparent && Node.isCallExpression(grandparent)) {
      const args = grandparent.getArguments();
      if (args.length > 0) {
        return formatResponseShape(args[0].getText());
      }
    }
  }
  
  // Try regex as fallback
  const jsonMatch = parentText.match(/\.json\(([^)]+)\)/);
  if (jsonMatch) {
    return formatResponseShape(jsonMatch[1]);
  }
  
  return undefined;
}

/**
 * Extracts example response from call
 */
function extractResponseExample(call: CallExpression): string | undefined {
  const text = call.getText();
  const jsonMatch = text.match(/\.json\((\{[^}]+\})\)/);
  if (jsonMatch) {
    return jsonMatch[1];
  }
  return undefined;
}

/**
 * Gets human-readable description for HTTP status code
 */
function getStatusDescription(statusCode: number): string {
  const descriptions: Record<number, string> = {
    200: 'Success',
    201: 'Created',
    204: 'No Content',
    301: 'Moved Permanently',
    302: 'Found (Redirect)',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable'
  };
  return descriptions[statusCode] || `HTTP ${statusCode}`;
}

/**
 * Generates a descriptive summary of the handler's behavior
 * Now accepts pre-computed calls and side effects to avoid re-computing
 */
function generateDescription(
  route: Route, 
  handler: Node,
  externalCalls?: ExternalCall[],
  sideEffects?: SideEffect[]
): string {
  const parts: string[] = [];
  parts.push(`${route.method} ${route.path}`);
  
  const calls = externalCalls || [];
  if (calls.length > 0) {
    const targets = calls.slice(0, 2).map(c => `${c.type}: ${c.target}`);
    parts.push(`Calls [${targets.join(', ')}]`);
  }
  
  const effects = sideEffects || [];
  if (effects.length > 0) {
    parts.push(`Side effects [${effects.slice(0, 2).map(e => e.type).join(', ')}]`);
  }
  
  return parts.join(' - ');
}

/**
 * Extracts request data shape from handler
 */
function extractRequestShape(handler: Node): string {
  const shapes: Set<string> = new Set();
  const fields: Map<string, string[]> = new Map();

  const propertyAccesses = handler.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);

  for (const access of propertyAccesses) {
    const text = access.getText();
    
    // Extract req.body.field patterns
    const bodyMatch = text.match(/req\.body\.(\w+)/);
    if (bodyMatch) {
      if (!fields.has('body')) fields.set('body', []);
      fields.get('body')!.push(bodyMatch[1]);
      continue;
    }
    
    // Extract req.query.field patterns
    const queryMatch = text.match(/req\.query\.(\w+)/);
    if (queryMatch) {
      if (!fields.has('query')) fields.set('query', []);
      fields.get('query')!.push(queryMatch[1]);
      continue;
    }
    
    // Extract req.params.field patterns
    const paramsMatch = text.match(/req\.params\.(\w+)/);
    if (paramsMatch) {
      if (!fields.has('params')) fields.set('params', []);
      fields.get('params')!.push(paramsMatch[1]);
      continue;
    }

    // Generic patterns
    if (text.startsWith('req.body')) shapes.add('body');
    if (text.startsWith('req.query')) shapes.add('query');
    if (text.startsWith('req.params')) shapes.add('params');
    if (text.startsWith('req.headers')) shapes.add('headers');
    if (text.startsWith('req.file')) shapes.add('file');
  }

  // Build detailed shape if we found specific fields
  if (fields.size > 0) {
    const parts: string[] = [];
    for (const [source, sourceFields] of fields) {
      const uniqueFields = [...new Set(sourceFields)];
      parts.push(`${source}: { ${uniqueFields.join(', ')} }`);
    }
    return `{ ${parts.join(', ')} }`;
  }

  // Fallback to generic shapes
  if (shapes.size > 0) {
    return `{ ${[...shapes].map(s => `${s}: object`).join(', ')} }`;
  }

  return '{}';
}

/**
 * Extracts response data shape from handler
 */
function extractResponseShape(handler: Node): string {
  const calls = handler.getDescendantsOfKind(SyntaxKind.CallExpression);
  
  for (const call of calls) {
    const expr = call.getExpression().getText();
    
    // Look for res.json() or res.send()
    if (expr.includes('res.json') || expr.includes('res.send')) {
      const args = call.getArguments();
      if (args.length > 0) {
        const responseText = args[0].getText();
        // Clean up and return the response shape
        return formatResponseShape(responseText);
      }
    }
    
    // Look for chained response: res.status(200).json({...})
    if (expr.includes('.json') || expr.includes('.send')) {
      const args = call.getArguments();
      if (args.length > 0) {
        const responseText = args[0].getText();
        return formatResponseShape(responseText);
      }
    }
  }

  return '{}';
}

/**
 * Formats response shape for display
 */
function formatResponseShape(text: string): string {
  // Truncate very long responses
  if (text.length > 200) {
    return text.substring(0, 200) + '...';
  }
  return text;
}

/**
 * Finds all outcomes (success/error responses)
 */
function findOutcomes(handler: Node): Outcome[] {
  const outcomes: Outcome[] = [];
  const seenStatusCodes = new Set<number>();

  const calls = handler.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of calls) {
    const expr = call.getExpression().getText();
    
    // Look for res.status(code)
    if (expr.includes('res.status') || expr.includes('.status')) {
      const args = call.getArguments();
      if (args.length > 0) {
        const statusCode = parseInt(args[0].getText().replace(/['"]/g, ''), 10);
        if (!isNaN(statusCode) && !seenStatusCodes.has(statusCode)) {
          seenStatusCodes.add(statusCode);
          outcomes.push({
            type: statusCode >= ERROR_THRESHOLD ? 'error' : 'success',
            statusCode,
            description: extractMessageFromChain(call)
          });
        }
      }
    }
    
    // Look for res.redirect()
    if (expr.includes('res.redirect')) {
      const args = call.getArguments();
      outcomes.push({
        type: 'success',
        statusCode: 302,
        nextStep: args[0]?.getText().replace(/['"]/g, ''),
        description: 'Redirect'
      });
    }
  }

  // If no outcomes found, add default success
  if (outcomes.length === 0) {
    outcomes.push({
      type: 'success',
      statusCode: DEFAULT_STATUS_CODE,
      description: 'Success response'
    });
  }

  return outcomes;
}

/**
 * Extracts message from chained response like res.status(400).json({ message: '...' })
 */
function extractMessageFromChain(statusCall: CallExpression): string {
  const parent = statusCall.getParent();
  if (!parent) return 'Response';

  // Look for .json() or .send() in the chain
  const text = parent.getText();
  
  const messageMatch = text.match(/message:\s*['"`]([^'"`]+)['"`]/);
  if (messageMatch) return messageMatch[1];
  
  const errorMatch = text.match(/error:\s*['"`]([^'"`]+)['"`]/);
  if (errorMatch) return errorMatch[1];
  
  return 'Response';
}

/**
 * Finds external API/database calls including payment providers, cloud services, etc.
 */
function findExternalCalls(handler: Node): ExternalCall[] {
  const calls: ExternalCall[] = [];
  const seen = new Set<string>();

  const callExpressions = handler.getDescendantsOfKind(SyntaxKind.CallExpression);
  const handlerText = handler.getText();

  for (const call of callExpressions) {
    const text = call.getText();
    
    // HTTP clients: axios, fetch, got, superagent
    if (text.match(/\b(axios|fetch|got|superagent|request)\b/i)) {
      const target = extractCallTarget(call);
      if (!seen.has(`http:${target}`)) {
        seen.add(`http:${target}`);
        calls.push({
          type: 'http',
          target,
          method: extractHttpMethod(text)
        });
      }
    }
    
    // Database: Prisma, Mongoose, TypeORM, Sequelize, Knex
    if (text.match(/\b(prisma|mongoose|typeorm|sequelize|knex|db|model)\b/i) ||
        text.match(/\.(find|create|update|delete|save|insert|query|aggregate|populate)/i)) {
      const target = extractDbTarget(text);
      if (target && !seen.has(`db:${target}`)) {
        seen.add(`db:${target}`);
        calls.push({
          type: 'database',
          target
        });
      }
    }
  }
  
  // Payment providers
  if (handlerText.match(/\b(stripe|paystack|flutterwave|paypal|razorpay|square)\b/i)) {
    const service = extractServiceName(handlerText, ['stripe', 'paystack', 'flutterwave', 'paypal', 'razorpay', 'square']);
    if (service && !seen.has(`payment:${service}`)) {
      seen.add(`payment:${service}`);
      calls.push({
        type: 'payment',
        target: extractPaymentOperation(handlerText),
        service: capitalizeFirst(service)
      });
    }
  }
  
  // Cloud storage
  if (handlerText.match(/\b(s3|cloudinary|gcs|azure.*blob|minio|uploadthing)\b/i)) {
    const service = extractServiceName(handlerText, ['s3', 'cloudinary', 'gcs', 'minio', 'uploadthing']);
    if (service && !seen.has(`storage:${service}`)) {
      seen.add(`storage:${service}`);
      calls.push({
        type: 'storage',
        target: 'File upload/storage',
        service: service === 's3' ? 'AWS S3' : capitalizeFirst(service)
      });
    }
  }
  
  // Email services
  if (handlerText.match(/\b(sendgrid|mailgun|ses|postmark|mailchimp|resend)\b/i)) {
    const service = extractServiceName(handlerText, ['sendgrid', 'mailgun', 'ses', 'postmark', 'mailchimp', 'resend']);
    if (service && !seen.has(`email:${service}`)) {
      seen.add(`email:${service}`);
      calls.push({
        type: 'email',
        target: 'Send email',
        service: service === 'ses' ? 'AWS SES' : capitalizeFirst(service)
      });
    }
  }

  return calls;
}

/**
 * Extracts service name from text
 */
function extractServiceName(text: string, services: string[]): string | null {
  const lowerText = text.toLowerCase();
  for (const service of services) {
    if (lowerText.includes(service)) {
      return service;
    }
  }
  return null;
}

/**
 * Extracts payment operation type
 */
function extractPaymentOperation(text: string): string {
  if (text.match(/\b(charge|payment|pay|checkout)\b/i)) return 'Process payment';
  if (text.match(/\b(refund)\b/i)) return 'Process refund';
  if (text.match(/\b(subscription|subscribe)\b/i)) return 'Manage subscription';
  if (text.match(/\b(transfer)\b/i)) return 'Transfer funds';
  if (text.match(/\b(verify|validate)\b/i)) return 'Verify payment';
  return 'Payment operation';
}

/**
 * Capitalizes first letter
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Extracts target URL from HTTP call
 */
function extractCallTarget(call: CallExpression): string {
  const args = call.getArguments();
  if (args.length > 0) {
    const arg = args[0].getText().replace(/['"`]/g, '');
    // Truncate long URLs
    return arg.length > 50 ? arg.substring(0, 50) + '...' : arg;
  }
  return 'unknown';
}

/**
 * Extracts HTTP method from call
 */
function extractHttpMethod(text: string): string {
  if (text.includes('.get(')) return 'GET';
  if (text.includes('.post(')) return 'POST';
  if (text.includes('.put(')) return 'PUT';
  if (text.includes('.patch(')) return 'PATCH';
  if (text.includes('.delete(')) return 'DELETE';
  
  const methodMatch = text.match(/method:\s*['"](\w+)['"]/i);
  return methodMatch ? methodMatch[1].toUpperCase() : 'GET';
}

/**
 * Extracts database target (table/model name)
 */
function extractDbTarget(text: string): string | null {
  // prisma.user.findMany() -> user
  const prismaMatch = text.match(/prisma\.(\w+)\./);
  if (prismaMatch) return prismaMatch[1];
  
  // db.collection('users') -> users
  const collectionMatch = text.match(/collection\(['"](\w+)['"]\)/);
  if (collectionMatch) return collectionMatch[1];
  
  // User.findOne() -> User
  const modelMatch = text.match(/\b([A-Z]\w+)\.(find|create|update|delete|save)/);
  if (modelMatch) return modelMatch[1];
  
  return null;
}

/**
 * Finds side effects (email, queue, cache, file, socket, webhook operations)
 */
function findSideEffects(handler: Node): SideEffect[] {
  const effects: SideEffect[] = [];
  const text = handler.getText();

  // Email
  if (text.match(/\b(sendEmail|sendMail|email|mailer|nodemailer|sendgrid|mailgun|ses|postmark)\b/i)) {
    effects.push({ type: 'email', description: 'Sends email notification' });
  }

  // Queue/messaging
  if (text.match(/\b(publish|queue|amqp|rabbitmq|kafka|sqs|bull|redis\.publish|pubsub|nats)\b/i)) {
    effects.push({ type: 'queue', description: 'Publishes message to queue' });
  }

  // Cache
  if (text.match(/\b(redis|cache|memcached|setCache|invalidate|del\(|flushall)\b/i)) {
    effects.push({ type: 'cache', description: 'Updates cache' });
  }

  // File/storage operations
  if (text.match(/\b(writeFile|createWriteStream|upload|s3\.put|storage|unlink|rmdir|cloudinary)\b/i)) {
    effects.push({ type: 'file', description: 'Writes to file/storage' });
  }
  
  // Socket/realtime
  if (text.match(/\b(socket|io\.emit|broadcast|websocket|pusher|ably)\b/i)) {
    effects.push({ type: 'socket', description: 'Emits realtime event' });
  }
  
  // Webhook
  if (text.match(/\b(webhook|callback|notify|trigger)\b/i) && text.match(/\b(post|send|emit)\b/i)) {
    effects.push({ type: 'webhook', description: 'Triggers webhook' });
  }
  
  // Push notifications
  if (text.match(/\b(fcm|firebase|apns|push|notification|onesignal|expo.*push)\b/i)) {
    effects.push({ type: 'notification', description: 'Sends push notification' });
  }

  return effects;
}
