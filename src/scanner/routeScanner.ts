import { Project, SyntaxKind, Node, CallExpression, SourceFile } from 'ts-morph';
import { Route } from '../types';
import * as path from 'path';
import * as fs from 'fs';

/** Tracks visited files to prevent circular imports */
const visitedFiles = new Set<string>();

/** Cache for parsed source files */
const sourceFileCache = new Map<string, SourceFile>();

/** Shared project instance for efficiency */
let sharedProject: Project | null = null;

/** HTTP methods supported by Express */
const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all'];

/** Tracks processed chained route calls to avoid duplicates */
const processedChainedCalls = new Set<number>();

/**
 * Scans files for Express routes including modular router patterns
 * Handles: app.get(), router.post(), app.use('/path', router), router.route('/path').get().post(), etc.
 */
export function scanRoutes(files: string[]): Route[] {
  const routes: Route[] = [];
  
  // Reset state for new scan
  visitedFiles.clear();
  sourceFileCache.clear();
  processedChainedCalls.clear();
  sharedProject = new Project({ skipFileDependencyResolution: true });

  for (const file of files) {
    try {
      const fileRoutes = scanFile(file, '');
      routes.push(...fileRoutes);
    } catch (e) {
      console.warn(`Warning: Could not parse ${file}:`, e instanceof Error ? e.message : e);
    }
  }

  // Cleanup
  sharedProject = null;
  
  return routes;
}

/**
 * Scans a single file for routes, with optional mount path prefix
 */
function scanFile(filePath: string, mountPath: string): Route[] {
  // Prevent circular imports
  const absolutePath = path.resolve(filePath);
  if (visitedFiles.has(absolutePath)) {
    return [];
  }
  visitedFiles.add(absolutePath);

  const routes: Route[] = [];
  const sourceFile = getSourceFile(filePath);
  if (!sourceFile) return routes;

  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of callExpressions) {
    // Check for chained route pattern: router.route('/path').get().post()
    // Must check this first to avoid partial matching by direct route detection
    const chainedRoutes = extractChainedRoutes(call, mountPath);
    if (chainedRoutes.length > 0) {
      routes.push(...chainedRoutes);
      continue;
    }

    // Check for direct route definitions: app.get(), router.post(), etc.
    const directRoute = extractDirectRoute(call, mountPath);
    if (directRoute) {
      routes.push(directRoute);
      continue;
    }

    // Check for router mounting: app.use('/api', router)
    const mountedRoutes = extractMountedRoutes(call, sourceFile, mountPath);
    routes.push(...mountedRoutes);
  }

  return routes;
}

/**
 * Gets or creates a source file from the cache
 */
function getSourceFile(filePath: string): SourceFile | null {
  const absolutePath = path.resolve(filePath);
  
  if (sourceFileCache.has(absolutePath)) {
    return sourceFileCache.get(absolutePath)!;
  }

  if (!sharedProject) return null;
  
  try {
    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      return null;
    }
    
    const sourceFile = sharedProject.addSourceFileAtPath(absolutePath);
    sourceFileCache.set(absolutePath, sourceFile);
    return sourceFile;
  } catch (e) {
    console.warn(`Warning: Could not load ${absolutePath}`);
    return null;
  }
}

/**
 * Extracts a direct route definition like app.get('/users', handler)
 */
function extractDirectRoute(call: CallExpression, mountPath: string): Route | null {
  const expression = call.getExpression();
  const expressionText = expression.getText();

  // Match: app.get, app.post, router.get, router.post, etc.
  const routeMatch = expressionText.match(/\b(app|router)\.(get|post|put|delete|patch)\s*$/i);
  if (!routeMatch) return null;

  const args = call.getArguments();
  if (args.length < 2) return null;

  // First arg: path string
  const pathArg = args[0];
  const routePath = extractStringValue(pathArg);
  if (!routePath) return null;

  // Combine mount path with route path
  const fullPath = combinePaths(mountPath, routePath);

  // Method from the call
  const method = routeMatch[2].toUpperCase() as Route['method'];

  // Last arg is the handler
  const handlerArg = args[args.length - 1];
  const handlerName = handlerArg.getText();

  // Middleware: everything between path and handler
  const middleware = args.slice(1, -1).map(a => a.getText());

  const sourceFile = call.getSourceFile();

  return {
    method,
    path: fullPath,
    handlerName,
    handlerFile: sourceFile.getFilePath(),
    middleware,
    sourceLocation: {
      file: sourceFile.getFilePath(),
      line: call.getStartLineNumber()
    }
  };
}

/**
 * Extracts routes from router.route('/path').get().post().put() chained pattern
 * 
 * AST Structure for router.route('/users').get(handler1).post(handler2):
 * 
 * CallExpression (.post(handler2))
 *   └─ Expression: MemberExpression
 *        └─ Object: CallExpression (.get(handler1))
 *             └─ Expression: MemberExpression  
 *                  └─ Object: CallExpression (router.route('/users'))
 *                       └─ Expression: router.route
 *                       └─ Arguments: ['/users']
 *                  └─ Name: get
 *             └─ Arguments: [handler1]
 *        └─ Name: post
 *   └─ Arguments: [handler2]
 * 
 * We need to:
 * 1. Find the root router.route('/path') call
 * 2. Walk up the chain collecting each HTTP method call
 * 3. Create a Route for each method with the same base path
 */
function extractChainedRoutes(call: CallExpression, mountPath: string): Route[] {
  const routes: Route[] = [];
  
  // Use position to track already-processed chain roots
  const callPos = call.getPos();
  if (processedChainedCalls.has(callPos)) {
    return [];
  }

  // Find the root router.route() call by walking down the chain
  const chainInfo = findRouteChainRoot(call);
  if (!chainInfo) return [];

  const { rootCall, routePath, chainedMethods } = chainInfo;
  
  // Mark all calls in this chain as processed to avoid duplicates
  const rootPos = rootCall.getPos();
  processedChainedCalls.add(rootPos);

  const fullBasePath = combinePaths(mountPath, routePath);
  const sourceFile = call.getSourceFile();

  // Create a route for each chained method
  for (const methodInfo of chainedMethods) {
    const route: Route = {
      method: methodInfo.method.toUpperCase() as Route['method'],
      path: fullBasePath,
      handlerName: methodInfo.handler,
      handlerFile: sourceFile.getFilePath(),
      middleware: methodInfo.middleware,
      sourceLocation: {
        file: sourceFile.getFilePath(),
        line: methodInfo.line
      }
    };
    routes.push(route);
  }

  return routes;
}

/**
 * Information about a chained method call (.get, .post, etc.)
 */
interface ChainedMethodInfo {
  method: string;
  handler: string;
  middleware: string[];
  line: number;
}

/**
 * Result of finding the chain root
 */
interface ChainRootInfo {
  rootCall: CallExpression;
  routePath: string;
  chainedMethods: ChainedMethodInfo[];
}

/**
 * Walks up the AST to find router.route('/path') and collects all chained methods
 * 
 * For: router.route('/users').get(getUsers).post(createUser)
 * Returns: { rootCall, routePath: '/users', chainedMethods: [{get, getUsers}, {post, createUser}] }
 */
function findRouteChainRoot(call: CallExpression): ChainRootInfo | null {
  const chainedMethods: ChainedMethodInfo[] = [];
  let current: Node = call;

  // Walk up the chain collecting method calls
  while (current && Node.isCallExpression(current)) {
    const expr = current.getExpression();
    
    // Check if this is a MemberExpression (something.method)
    if (Node.isPropertyAccessExpression(expr)) {
      const methodName = expr.getName().toLowerCase();
      const object = expr.getExpression();

      // Check if this is the root router.route() call
      if (Node.isCallExpression(object)) {
        const objectExpr = object.getExpression();
        const objectText = objectExpr.getText();

        // Found router.route() - this is the root!
        if (objectText.match(/\b(app|router)\.route\s*$/i)) {
          const args = object.getArguments();
          if (args.length > 0) {
            const routePath = extractStringValue(args[0]);
            if (routePath !== null) {
              // Add the current method to the chain if it's an HTTP method
              if (HTTP_METHODS.includes(methodName)) {
                const methodInfo = extractMethodInfo(current as CallExpression, methodName);
                chainedMethods.unshift(methodInfo); // Add to front since we're walking up
              }
              
              return {
                rootCall: object,
                routePath,
                chainedMethods
              };
            }
          }
          return null; // router.route() without valid path
        }

        // This is a chained HTTP method call, collect it and continue up
        if (HTTP_METHODS.includes(methodName)) {
          const methodInfo = extractMethodInfo(current as CallExpression, methodName);
          chainedMethods.unshift(methodInfo); // Add to front since we're walking up
          current = object; // Move up the chain
          continue;
        }
      }

      // Check if this is a direct router.route() call (no chaining above)
      const objectText = object.getText();
      if (objectText?.match(/\b(app|router)\s*$/i) && methodName === 'route') {
        // This IS the router.route() call, but we need to get the path and check for chains
        const args = (current as CallExpression).getArguments();
        if (args.length > 0) {
          const routePath = extractStringValue(args[0]);
          if (routePath !== null) {
            // Check if there are chained calls below this
            const parent = current.getParent();
            if (parent && Node.isPropertyAccessExpression(parent)) {
              // There might be chains below, return what we have
              return {
                rootCall: current as CallExpression,
                routePath,
                chainedMethods
              };
            }
          }
        }
        return null;
      }
    }

    // Move to parent to check if we're part of a larger chain
    const parent = current.getParent();
    if (parent && Node.isPropertyAccessExpression(parent)) {
      const grandparent = parent.getParent();
      if (grandparent && Node.isCallExpression(grandparent)) {
        // We're the object of another call, this current call is not the outermost
        // Return null to avoid processing inner calls; we'll process from the outer call
        return null;
      }
    }

    break;
  }

  return null;
}

/**
 * Extracts method info from a chained call like .get(handler) or .post(middleware, handler)
 */
function extractMethodInfo(call: CallExpression, methodName: string): ChainedMethodInfo {
  const args = call.getArguments();
  
  // Last argument is the handler, others are middleware
  const handler = args.length > 0 ? args[args.length - 1].getText() : 'anonymous';
  const middleware = args.length > 1 ? args.slice(0, -1).map(a => a.getText()) : [];

  return {
    method: methodName,
    handler,
    middleware,
    line: call.getStartLineNumber()
  };
}

/**
 * Extracts routes from app.use('/path', router) patterns
 */
function extractMountedRoutes(
  call: CallExpression,
  sourceFile: SourceFile,
  parentMountPath: string
): Route[] {
  const expression = call.getExpression();
  const expressionText = expression.getText();

  // Match: app.use or router.use
  if (!expressionText.match(/\b(app|router)\.use\s*$/i)) {
    return [];
  }

  const args = call.getArguments();
  if (args.length === 0) return [];

  let mountPath = '';
  let routerArg: Node | null = null;

  // Parse arguments: app.use('/path', router) or app.use(router)
  if (args.length === 1) {
    // app.use(router) - no mount path
    routerArg = args[0];
  } else if (args.length >= 2) {
    // app.use('/path', router) or app.use('/path', middleware, router)
    const firstArgText = args[0].getText();
    
    // Check if first arg is a string (mount path)
    if (firstArgText.startsWith("'") || firstArgText.startsWith('"') || firstArgText.startsWith('`')) {
      mountPath = extractStringValue(args[0]) || '';
      routerArg = args[args.length - 1]; // Last arg is the router
    } else {
      // First arg is middleware, no mount path
      routerArg = args[args.length - 1];
    }
  }

  if (!routerArg) return [];

  const fullMountPath = combinePaths(parentMountPath, mountPath);
  const routerIdentifier = routerArg.getText();

  // Skip if it looks like middleware (function call or inline function)
  if (routerIdentifier.includes('(') && !routerIdentifier.match(/^\w+$/)) {
    return [];
  }

  // Resolve the router import
  const routerFilePath = resolveImport(sourceFile, routerIdentifier);
  if (!routerFilePath) {
    // Could be an inline router or middleware - skip
    return [];
  }

  // Recursively scan the router file
  return scanFile(routerFilePath, fullMountPath);
}

/**
 * Resolves an import identifier to its source file path
 */
function resolveImport(sourceFile: SourceFile, identifier: string): string | null {
  const importDeclarations = sourceFile.getImportDeclarations();

  for (const importDecl of importDeclarations) {
    // Check default import: import authRoutes from './routes/auth'
    const defaultImport = importDecl.getDefaultImport();
    if (defaultImport?.getText() === identifier) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      return resolveModulePath(sourceFile.getFilePath(), moduleSpecifier);
    }

    // Check named imports: import { authRoutes } from './routes'
    const namedImports = importDecl.getNamedImports();
    for (const namedImport of namedImports) {
      const importName = namedImport.getAliasNode()?.getText() || namedImport.getName();
      if (importName === identifier) {
        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        return resolveModulePath(sourceFile.getFilePath(), moduleSpecifier);
      }
    }

    // Check namespace import: import * as routes from './routes'
    const namespaceImport = importDecl.getNamespaceImport();
    if (namespaceImport?.getText() === identifier) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      return resolveModulePath(sourceFile.getFilePath(), moduleSpecifier);
    }
  }

  // Check for require() calls: const authRoutes = require('./routes/auth')
  const variableDeclarations = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
  for (const varDecl of variableDeclarations) {
    if (varDecl.getName() === identifier) {
      const initializer = varDecl.getInitializer();
      if (initializer && Node.isCallExpression(initializer)) {
        const callExpr = initializer.getExpression().getText();
        if (callExpr === 'require') {
          const args = initializer.getArguments();
          if (args.length > 0) {
            const modulePath = extractStringValue(args[0]);
            if (modulePath) {
              return resolveModulePath(sourceFile.getFilePath(), modulePath);
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Resolves a module specifier to an absolute file path
 */
function resolveModulePath(currentFile: string, moduleSpecifier: string): string | null {
  // Skip node_modules imports
  if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) {
    return null;
  }

  const dir = path.dirname(currentFile);
  let resolved = path.resolve(dir, moduleSpecifier);

  // Try different extensions
  const extensions = ['.ts', '.js', '.mts', '.mjs', '/index.ts', '/index.js'];
  
  for (const ext of extensions) {
    const withExt = resolved + ext;
    if (fs.existsSync(withExt)) {
      return withExt;
    }
  }

  // Check if path already has extension
  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (stat.isFile()) {
      return resolved;
    }
    // It's a directory, try index files
    for (const ext of ['/index.ts', '/index.js']) {
      const indexPath = resolved + ext;
      if (fs.existsSync(indexPath)) {
        return indexPath;
      }
    }
  }

  return null;
}

/**
 * Extracts string value from a node (handles quotes and template literals)
 */
function extractStringValue(node: Node): string | null {
  const text = node.getText();
  
  // String literal: 'path' or "path"
  if (text.startsWith("'") || text.startsWith('"')) {
    return text.slice(1, -1);
  }
  
  // Template literal: `path`
  if (text.startsWith('`')) {
    // Simple template without expressions
    if (!text.includes('${')) {
      return text.slice(1, -1);
    }
  }
  
  return null;
}

/**
 * Combines mount path with route path, handling edge cases
 */
function combinePaths(mountPath: string, routePath: string): string {
  // Normalize paths
  const mount = mountPath.replace(/\/+$/, ''); // Remove trailing slashes
  const route = routePath.startsWith('/') ? routePath : '/' + routePath;
  
  // Handle root route
  if (route === '/') {
    return mount || '/';
  }
  
  return mount + route;
}
