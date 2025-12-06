import { Project, Node, SyntaxKind, SourceFile, CallExpression } from 'ts-morph';
import { Route, HandlerAnalysis, ExternalCall, SideEffect, Outcome } from '../types';
import * as path from 'path';
import * as fs from 'fs';

const DEFAULT_STATUS_CODE = 200;
const ERROR_THRESHOLD = 400;

/** Cache for source files to avoid re-parsing */
const sourceFileCache = new Map<string, SourceFile>();
let sharedProject: Project | null = null;

/**
 * Analyzes an Express route handler to extract behavior information
 * including request/response patterns, external calls, and side effects
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

    const analysis: HandlerAnalysis = {
      endpoint: `${route.method} ${route.path}`,
      description: generateDescription(route, handler),
      dataIn: extractRequestShape(handler),
      dataOut: extractResponseShape(handler),
      externalCalls: findExternalCalls(handler),
      sideEffects: findSideEffects(handler),
      outcomes: findOutcomes(handler)
    };

    return analysis;
  } catch (error) {
    console.warn(`Warning: Failed to analyze handler for ${route.method} ${route.path}:`, error);
    return createDefaultAnalysis(route);
  }
}

/**
 * Clears the analyzer cache (call between scans)
 */
export function clearAnalyzerCache(): void {
  sourceFileCache.clear();
  sharedProject = null;
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
  
  for (const arrow of arrowFunctions) {
    const text = arrow.getText();
    // Match if the handler name is a substring (it's the inline definition)
    if (handlerName.includes(text.substring(0, 50)) || text.includes(handlerName.substring(0, 50))) {
      return arrow;
    }
  }

  // Return first inline handler as fallback
  return arrowFunctions[0] || sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression)[0] || null;
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
  return {
    endpoint: `${route.method} ${route.path}`,
    description: `Handler for ${route.method} ${route.path}`,
    dataIn: '{}',
    dataOut: '{}',
    externalCalls: [],
    sideEffects: [],
    outcomes: [{
      type: 'success',
      statusCode: 200,
      description: 'Success response'
    }]
  };
}

/**
 * Generates a descriptive summary of the handler's behavior
 */
function generateDescription(route: Route, handler: Node): string {
  const parts: string[] = [];
  parts.push(`${route.method} ${route.path}`);
  
  const externalCalls = findExternalCalls(handler);
  if (externalCalls.length > 0) {
    const targets = externalCalls.slice(0, 2).map(c => `${c.type}: ${c.target}`);
    parts.push(`Calls [${targets.join(', ')}]`);
  }
  
  const sideEffects = findSideEffects(handler);
  if (sideEffects.length > 0) {
    parts.push(`Side effects [${sideEffects.slice(0, 2).map(e => e.type).join(', ')}]`);
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
 * Finds external API/database calls
 */
function findExternalCalls(handler: Node): ExternalCall[] {
  const calls: ExternalCall[] = [];
  const seen = new Set<string>();

  const callExpressions = handler.getDescendantsOfKind(SyntaxKind.CallExpression);

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
    
    // Database: Prisma, Mongoose, TypeORM, Sequelize
    if (text.match(/\b(prisma|mongoose|typeorm|sequelize|db|model)\b/i) ||
        text.match(/\.(find|create|update|delete|save|insert|query)/i)) {
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

  return calls;
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
 * Finds side effects (email, queue, cache, file operations)
 */
function findSideEffects(handler: Node): SideEffect[] {
  const effects: SideEffect[] = [];
  const text = handler.getText();

  // Email
  if (text.match(/\b(sendEmail|sendMail|email|mailer|nodemailer|sendgrid|mailgun)\b/i)) {
    effects.push({ type: 'email', description: 'Sends email notification' });
  }

  // Queue/messaging
  if (text.match(/\b(publish|queue|amqp|rabbitmq|kafka|sqs|bull)\b/i)) {
    effects.push({ type: 'queue', description: 'Publishes message to queue' });
  }

  // Cache
  if (text.match(/\b(redis|cache|memcached|setCache|invalidate)\b/i)) {
    effects.push({ type: 'cache', description: 'Updates cache' });
  }

  // File operations
  if (text.match(/\b(writeFile|createWriteStream|upload|s3\.put|storage)\b/i)) {
    effects.push({ type: 'file', description: 'Writes to file/storage' });
  }

  return effects;
}
