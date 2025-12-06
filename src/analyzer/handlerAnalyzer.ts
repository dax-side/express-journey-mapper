import { Project, Node, SyntaxKind, SourceFile, CallExpression, ArrowFunction, FunctionExpression } from 'ts-morph';
import { Route, HandlerAnalysis, ExternalCall, SideEffect, Outcome } from '../types';

const DEFAULT_STATUS_CODE = 200;
const ERROR_THRESHOLD = 400;

/**
 * Analyzes an Express route handler to extract behavior information
 * including request/response patterns, external calls, and side effects
 */
export function analyzeHandler(route: Route): HandlerAnalysis {
  try {
    const project = new Project();
    const sourceFile = project.addSourceFileAtPath(route.handlerFile);

    const handler = findHandlerFunction(sourceFile, route.handlerName);
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
 * Attempts to find the handler function in various declaration forms
 */
function findHandlerFunction(sourceFile: SourceFile, handlerName: string): Node | null {
  // Handle inline arrow/function expressions
  if (handlerName.includes('=>') || handlerName.includes('function')) {
    return findInlineHandler(sourceFile, handlerName);
  }

  // Look for named function declarations
  const functions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
  for (const func of functions) {
    if (func.getName() === handlerName) {
      return func;
    }
  }

  // Look for variable declarations (const handler = ...)
  const variables = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
  for (const variable of variables) {
    if (variable.getName() === handlerName) {
      const initializer = variable.getInitializer();
      if (initializer) {
        return initializer;
      }
    }
  }

  // Look for method definitions in classes/objects
  const methods = sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration);
  for (const method of methods) {
    if (method.getName() === handlerName) {
      return method;
    }
  }

  return null;
}

/**
 * Handles inline handler expressions that are defined directly in route calls
 */
function findInlineHandler(sourceFile: SourceFile, handlerName: string): Node | null {
  const arrowFunctions = sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction);
  const functionExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression);
  
  // Return first inline handler found (they're typically defined at call site)
  return arrowFunctions[0] || functionExpressions[0] || null;
}

/**
 * Creates a minimal default analysis when handler cannot be parsed
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
  
  // Base description
  parts.push(`${route.method} ${route.path}`);
  
  // Add external call info
  const externalCalls = findExternalCalls(handler);
  if (externalCalls.length > 0) {
    const targets = externalCalls
      .map(call => `${call.type}: ${call.target}`)
      .slice(0, 2); // Limit to first 2 for brevity
    parts.push(`Calls [${targets.join(', ')}]`);
  }
  
  // Add side effect info
  const sideEffects = findSideEffects(handler);
  if (sideEffects.length > 0) {
    const effects = sideEffects
      .map(effect => effect.type)
      .slice(0, 2);
    parts.push(`Side effects [${effects.join(', ')}]`);
  }
  
  // Add outcome info from success response
  const outcomes = findOutcomes(handler);
  const successOutcome = outcomes.find(o => o.statusCode < ERROR_THRESHOLD);
  if (successOutcome?.description && successOutcome.description !== 'Response') {
    parts.push(`Returns: ${successOutcome.description}`);
  }
  
  return parts.join(' - ');
}

function extractRequestShape(handler: Node): string {
  // Look for req.body, req.params, req.query usage
  const calls = handler.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
  const shapes: string[] = [];

  for (const call of calls) {
    const text = call.getText();
    if (text.startsWith('req.body')) {
      shapes.push('body: object');
    } else if (text.startsWith('req.params')) {
      shapes.push('params: object');
    } else if (text.startsWith('req.query')) {
      shapes.push('query: object');
    }
  }

  return shapes.length > 0 ? `{ ${shapes.join(', ')} }` : '{}';
}

function extractResponseShape(handler: Node): string {
  // Look for res.json() calls
  const calls = handler.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const expr = call.getExpression();
    if (expr.getText().includes('res.json')) {
      const args = call.getArguments();
      if (args.length > 0) {
        return args[0].getText();
      }
    }
  }
  return '{}';
}

function findOutcomes(handler: Node): Outcome[] {
  const outcomes: Outcome[] = [];

  // Find all res.status() calls
  const statusCalls = handler.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(call => {
      const expr = call.getExpression().getText();
      return expr.includes('res.status') || expr.includes('res.json') || expr.includes('res.redirect');
    });

  for (const call of statusCalls) {
    const args = call.getArguments();

    // Extract status code
    let statusCode = 200;
    if (call.getExpression().getText().includes('status')) {
      statusCode = parseInt(args[0]?.getText().replace(/['"]/g, '') || '200');
    }

    // Determine type
    const type = statusCode >= 400 ? 'error' : 'success';

    // Check for redirect
    let nextStep: string | undefined;
    if (call.getExpression().getText().includes('redirect')) {
      nextStep = args[0]?.getText().replace(/['"]/g, '');
    }

    // Extract description from response body
    const description = extractDescription(call);

    outcomes.push({
      type,
      statusCode,
      nextStep,
      description
    });
  }

  return outcomes;
}

/**
 * Extracts human-readable description from response call
 */
function extractDescription(call: Node): string {
  // Type guard to ensure we have a CallExpression
  if (!Node.isCallExpression(call)) {
    return 'Response';
  }
  
  try {
    const callExpr = call as CallExpression;
    const args = callExpr.getArguments();
    
    if (args.length > 0 && callExpr.getExpression().getText().includes('json')) {
      const arg = args[0];
      const text = arg.getText();
      
      // Look for message property in response object
      if (text.includes('message')) {
        const match = text.match(/message:\s*['"]([^'"]+)['"]/);
        if (match) return match[1];
      }
      
      // Look for error property
      if (text.includes('error')) {
        const match = text.match(/error:\s*['"]([^'"]+)['"]/);
        if (match) return match[1];
      }
    }
  } catch (error) {
    console.warn('Warning: Error extracting description:', error);
  }
  
  return 'Response';
}

function findExternalCalls(handler: Node): ExternalCall[] {
  const calls: ExternalCall[] = [];

  // Look for HTTP calls: axios, fetch, etc.
  const httpCalls = handler.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(call => {
      const text = call.getText();
      return text.includes('axios') || text.includes('fetch') || text.includes('request');
    });

  for (const call of httpCalls) {
    calls.push({
      type: 'http',
      target: extractUrl(call),
      method: extractHttpMethod(call)
    });
  }

  // Look for database calls
  const dbCalls = handler.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(call => {
      const text = call.getText();
      return text.includes('db.') || text.includes('prisma.') || text.includes('.findOne') || text.includes('.create');
    });

  for (const call of dbCalls) {
    calls.push({
      type: 'database',
      target: extractTableName(call)
    });
  }

  return calls;
}

/**
 * Extracts URL from HTTP call expression
 */
function extractUrl(call: Node): string {
  if (!Node.isCallExpression(call)) {
    return 'unknown';
  }
  
  try {
    const callExpr = call as CallExpression;
    const args = callExpr.getArguments();
    
    if (args.length > 0) {
      const urlArg = args[0].getText().replace(/['"]/g, '').replace(/`/g, '');
      return urlArg || 'unknown';
    }
  } catch (error) {
    console.warn('Warning: Error extracting URL:', error);
  }
  
  return 'unknown';
}

/**
 * Extracts HTTP method from call expression
 */
function extractHttpMethod(call: Node): string {
  const text = call.getText();
  
  if (text.includes('.get(')) return 'GET';
  if (text.includes('.post(')) return 'POST';
  if (text.includes('.put(')) return 'PUT';
  if (text.includes('.patch(')) return 'PATCH';
  if (text.includes('.delete(')) return 'DELETE';
  
  // Check for method in config object (axios style)
  const methodMatch = text.match(/method:\s*['"](\w+)['"]/i);
  if (methodMatch) {
    return methodMatch[1].toUpperCase();
  }
  
  return 'GET';
}

/**
 * Extracts database table/model name from call expression
 */
function extractTableName(call: Node): string {
  const text = call.getText();
  
  // prisma.user.findMany() -> user
  const prismaMatch = text.match(/prisma\.(\w+)\./);
  if (prismaMatch) return prismaMatch[1];
  
  // db.collection('users') -> users
  const collectionMatch = text.match(/collection\(['"](\w+)['"]\)/);
  if (collectionMatch) return collectionMatch[1];
  
  // User.findOne() -> User
  const modelMatch = text.match(/(\w+)\.(findOne|find|create|update|delete)/);
  if (modelMatch) return modelMatch[1];
  
  return 'unknown';
}

function findSideEffects(handler: Node): SideEffect[] {
  const effects: SideEffect[] = [];

  // Look for email sending
  const emailCalls = handler.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(call => call.getText().includes('sendEmail') || call.getText().includes('email'));

  if (emailCalls.length > 0) {
    effects.push({
      type: 'email',
      description: 'Sends email notification'
    });
  }

  // Look for queue publishing
  const queueCalls = handler.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(call => call.getText().includes('publish') || call.getText().includes('queue'));

  if (queueCalls.length > 0) {
    effects.push({
      type: 'queue',
      description: 'Publishes message to queue'
    });
  }

  return effects;
}