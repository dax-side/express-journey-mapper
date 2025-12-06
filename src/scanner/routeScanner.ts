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

/**
 * Scans files for Express routes including modular router patterns
 * Handles: app.get(), router.post(), app.use('/path', router), etc.
 */
export function scanRoutes(files: string[]): Route[] {
  const routes: Route[] = [];
  
  // Reset state for new scan
  visitedFiles.clear();
  sourceFileCache.clear();
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
