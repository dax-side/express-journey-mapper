import { Project, Node, SyntaxKind, SourceFile, CallExpression } from 'ts-morph';
import { ValidationSchema, FieldSchema, MiddlewareInfo, ServiceCall, PathParam, QueryParam } from '../types';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Extracts validation schema from middleware (Joi, Zod, express-validator)
 */
export function extractValidationSchema(
  middlewareList: string[],
  sourceFile: SourceFile | null
): ValidationSchema | null {
  for (const middleware of middlewareList) {
    // Try to resolve the middleware to find validation schema
    if (!sourceFile) continue;
    
    const schema = findSchemaDefinition(sourceFile, middleware);
    if (schema) return schema;
  }
  return null;
}

/**
 * Finds and parses a schema definition from the source file or imports
 */
function findSchemaDefinition(sourceFile: SourceFile, middlewareName: string): ValidationSchema | null {
  // Extract the schema name from middleware like "validate(createTransactionSchema)"
  const argMatch = middlewareName.match(/\(([^)]+)\)/);
  const cleanName = argMatch ? argMatch[1].trim() : middlewareName.split('(')[0].trim();
  
  // Look for the middleware/validator in the file
  const variables = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
  
  for (const variable of variables) {
    if (variable.getName() === cleanName) {
      const initializer = variable.getInitializer();
      if (initializer) {
        return parseSchemaFromNode(initializer);
      }
    }
  }
  
  // Check imports and try to resolve
  const importDecls = sourceFile.getImportDeclarations();
  for (const importDecl of importDecls) {
    const namedImports = importDecl.getNamedImports();
    for (const namedImport of namedImports) {
      if (namedImport.getName() === cleanName) {
        const modulePath = importDecl.getModuleSpecifierValue();
        const resolvedPath = resolveModulePath(sourceFile.getFilePath(), modulePath);
        if (resolvedPath) {
          const importedFile = loadSourceFile(resolvedPath);
          if (importedFile) {
            return findSchemaDefinition(importedFile, cleanName);
          }
        }
      }
    }
  }
  
  return null;
}

/**
 * Parses a schema definition node (Joi/Zod/express-validator)
 */
function parseSchemaFromNode(node: Node): ValidationSchema | null {
  const text = node.getText();
  
  // Detect Joi schema
  if (text.includes('Joi.object') || text.includes('joi.object')) {
    return parseJoiSchema(text);
  }
  
  // Detect Zod schema
  if (text.includes('z.object') || text.includes('zod.object')) {
    return parseZodSchema(text);
  }
  
  // Detect express-validator
  if (text.includes('body(') || text.includes('param(') || text.includes('query(')) {
    return parseExpressValidatorSchema(text);
  }
  
  return null;
}

/**
 * Parses Joi schema definition
 * Example: Joi.object({ amount: Joi.number().required().min(100) })
 */
function parseJoiSchema(text: string): ValidationSchema {
  const fields: FieldSchema[] = [];
  
  // Match field definitions: fieldName: Joi.type().validators()
  const fieldRegex = /(\w+)\s*:\s*Joi\.(\w+)\(\)([^,}]*)/g;
  let match;
  
  while ((match = fieldRegex.exec(text)) !== null) {
    const [, name, type, validators] = match;
    const field: FieldSchema = {
      name,
      type: mapJoiType(type),
      required: validators.includes('.required()'),
      validation: extractJoiValidators(validators)
    };
    fields.push(field);
  }
  
  return {
    source: 'joi',
    fields,
    rawSchema: text.length > 500 ? text.substring(0, 500) + '...' : text
  };
}

/**
 * Maps Joi types to common types
 */
function mapJoiType(joiType: string): string {
  const typeMap: Record<string, string> = {
    'string': 'string',
    'number': 'number',
    'boolean': 'boolean',
    'date': 'Date',
    'object': 'object',
    'array': 'array',
    'binary': 'Buffer',
    'any': 'any'
  };
  return typeMap[joiType] || joiType;
}

/**
 * Extracts validation rules from Joi chain
 */
function extractJoiValidators(chain: string): string[] {
  const validators: string[] = [];
  
  const minMatch = chain.match(/\.min\((\d+)\)/);
  if (minMatch) validators.push(`min: ${minMatch[1]}`);
  
  const maxMatch = chain.match(/\.max\((\d+)\)/);
  if (maxMatch) validators.push(`max: ${maxMatch[1]}`);
  
  if (chain.includes('.email()')) validators.push('email format');
  if (chain.includes('.uri()') || chain.includes('.url()')) validators.push('URL format');
  if (chain.includes('.uuid()')) validators.push('UUID format');
  if (chain.includes('.alphanum()')) validators.push('alphanumeric');
  
  const patternMatch = chain.match(/\.pattern\(([^)]+)\)/);
  if (patternMatch) validators.push(`pattern: ${patternMatch[1]}`);
  
  const validMatch = chain.match(/\.valid\(([^)]+)\)/);
  if (validMatch) validators.push(`oneOf: [${validMatch[1]}]`);
  
  return validators;
}

/**
 * Parses Zod schema definition
 * Example: z.object({ amount: z.number().min(100) })
 */
function parseZodSchema(text: string): ValidationSchema {
  const fields: FieldSchema[] = [];
  
  // Match field definitions: fieldName: z.type().validators()
  const fieldRegex = /(\w+)\s*:\s*z\.(\w+)\(\)([^,}]*)/g;
  let match;
  
  while ((match = fieldRegex.exec(text)) !== null) {
    const [, name, type, validators] = match;
    const field: FieldSchema = {
      name,
      type: mapZodType(type),
      required: !validators.includes('.optional()'),
      validation: extractZodValidators(validators)
    };
    fields.push(field);
  }
  
  return {
    source: 'zod',
    fields,
    rawSchema: text.length > 500 ? text.substring(0, 500) + '...' : text
  };
}

/**
 * Maps Zod types to common types
 */
function mapZodType(zodType: string): string {
  const typeMap: Record<string, string> = {
    'string': 'string',
    'number': 'number',
    'boolean': 'boolean',
    'date': 'Date',
    'object': 'object',
    'array': 'array',
    'any': 'any',
    'unknown': 'unknown',
    'null': 'null',
    'undefined': 'undefined',
    'enum': 'enum',
    'union': 'union'
  };
  return typeMap[zodType] || zodType;
}

/**
 * Extracts validation rules from Zod chain
 */
function extractZodValidators(chain: string): string[] {
  const validators: string[] = [];
  
  const minMatch = chain.match(/\.min\((\d+)\)/);
  if (minMatch) validators.push(`min: ${minMatch[1]}`);
  
  const maxMatch = chain.match(/\.max\((\d+)\)/);
  if (maxMatch) validators.push(`max: ${maxMatch[1]}`);
  
  if (chain.includes('.email()')) validators.push('email format');
  if (chain.includes('.url()')) validators.push('URL format');
  if (chain.includes('.uuid()')) validators.push('UUID format');
  
  const regexMatch = chain.match(/\.regex\(([^)]+)\)/);
  if (regexMatch) validators.push(`pattern: ${regexMatch[1]}`);
  
  return validators;
}

/**
 * Parses express-validator chain
 * Example: body('amount').isNumeric().isLength({ min: 1 })
 */
function parseExpressValidatorSchema(text: string): ValidationSchema {
  const fields: FieldSchema[] = [];
  
  // Match body/param/query chains
  const chainRegex = /(body|param|query)\(['"](\w+)['"]\)([^;]+)/g;
  let match;
  
  while ((match = chainRegex.exec(text)) !== null) {
    const [, source, name, validators] = match;
    const field: FieldSchema = {
      name,
      type: inferExpressValidatorType(validators),
      required: validators.includes('.notEmpty()') || validators.includes('.exists()'),
      validation: extractExpressValidatorRules(validators),
      description: `From ${source}`
    };
    fields.push(field);
  }
  
  return {
    source: 'express-validator',
    fields,
    rawSchema: text.length > 500 ? text.substring(0, 500) + '...' : text
  };
}

/**
 * Infers type from express-validator chain
 */
function inferExpressValidatorType(chain: string): string {
  if (chain.includes('.isNumeric()') || chain.includes('.isInt()') || chain.includes('.isFloat()')) return 'number';
  if (chain.includes('.isBoolean()')) return 'boolean';
  if (chain.includes('.isEmail()')) return 'string (email)';
  if (chain.includes('.isUUID()')) return 'string (uuid)';
  if (chain.includes('.isURL()')) return 'string (url)';
  if (chain.includes('.isDate()')) return 'Date';
  if (chain.includes('.isArray()')) return 'array';
  if (chain.includes('.isObject()')) return 'object';
  return 'string';
}

/**
 * Extracts validation rules from express-validator chain
 */
function extractExpressValidatorRules(chain: string): string[] {
  const validators: string[] = [];
  
  const lengthMatch = chain.match(/\.isLength\(\{[^}]*min:\s*(\d+)/);
  if (lengthMatch) validators.push(`minLength: ${lengthMatch[1]}`);
  
  const maxLengthMatch = chain.match(/\.isLength\(\{[^}]*max:\s*(\d+)/);
  if (maxLengthMatch) validators.push(`maxLength: ${maxLengthMatch[1]}`);
  
  if (chain.includes('.isEmail()')) validators.push('email format');
  if (chain.includes('.isURL()')) validators.push('URL format');
  if (chain.includes('.isUUID()')) validators.push('UUID format');
  if (chain.includes('.isMongoId()')) validators.push('MongoDB ObjectId');
  if (chain.includes('.trim()')) validators.push('trimmed');
  if (chain.includes('.escape()')) validators.push('escaped');
  
  return validators;
}

/**
 * Analyzes middleware to extract auth, validation, rate limiting info
 */
export function analyzeMiddleware(middlewareList: string[]): MiddlewareInfo[] {
  const infos: MiddlewareInfo[] = [];
  
  for (const mw of middlewareList) {
    const info = classifyMiddleware(mw);
    if (info) infos.push(info);
  }
  
  return infos;
}

/**
 * Classifies a middleware by its name/pattern
 */
function classifyMiddleware(middleware: string): MiddlewareInfo | null {
  const lowerMw = middleware.toLowerCase();
  
  // Authentication middleware
  if (lowerMw.includes('auth') || lowerMw.includes('jwt') || lowerMw.includes('passport') ||
      lowerMw.includes('protect') || lowerMw.includes('guard')) {
    return {
      name: middleware,
      type: 'auth',
      details: extractAuthDetails(middleware)
    };
  }
  
  // Rate limiting
  if (lowerMw.includes('ratelimit') || lowerMw.includes('throttle') || lowerMw.includes('limiter')) {
    return {
      name: middleware,
      type: 'rateLimit',
      details: extractRateLimitDetails(middleware)
    };
  }
  
  // Validation
  if (lowerMw.includes('valid') || lowerMw.includes('schema') || lowerMw.includes('sanitize')) {
    return {
      name: middleware,
      type: 'validation',
      details: 'Request validation'
    };
  }
  
  // File upload
  if (lowerMw.includes('upload') || lowerMw.includes('multer') || lowerMw.includes('formidable')) {
    return {
      name: middleware,
      type: 'upload',
      details: 'File upload handling'
    };
  }
  
  // CORS
  if (lowerMw.includes('cors')) {
    return {
      name: middleware,
      type: 'cors',
      details: 'CORS configuration'
    };
  }
  
  return {
    name: middleware,
    type: 'unknown'
  };
}

/**
 * Extracts authentication details from middleware
 */
function extractAuthDetails(middleware: string): string {
  const lowerMw = middleware.toLowerCase();
  
  if (lowerMw.includes('admin')) return 'JWT required (admin role)';
  if (lowerMw.includes('user')) return 'JWT required (user role)';
  if (lowerMw.includes('optional')) return 'JWT optional';
  if (lowerMw.includes('jwt')) return 'JWT required';
  if (lowerMw.includes('passport')) return 'Passport authentication';
  if (lowerMw.includes('bearer')) return 'Bearer token required';
  if (lowerMw.includes('api') && lowerMw.includes('key')) return 'API key required';
  
  return 'Authentication required';
}

/**
 * Extracts rate limit details from middleware
 */
function extractRateLimitDetails(middleware: string): string {
  // Try to extract numbers from rate limit config
  const numbersMatch = middleware.match(/(\d+)/g);
  if (numbersMatch && numbersMatch.length >= 2) {
    return `${numbersMatch[0]} requests per ${numbersMatch[1]}ms`;
  }
  return 'Rate limited';
}

/**
 * Extracts path parameters from route path
 */
export function extractPathParams(routePath: string): PathParam[] {
  const params: PathParam[] = [];
  const paramRegex = /:(\w+)/g;
  let match;
  
  while ((match = paramRegex.exec(routePath)) !== null) {
    params.push({
      name: match[1],
      type: inferParamType(match[1]),
      example: generateParamExample(match[1])
    });
  }
  
  return params;
}

/**
 * Infers type from parameter name
 */
function inferParamType(paramName: string): string {
  const lowerName = paramName.toLowerCase();
  
  if (lowerName === 'id' || lowerName.endsWith('id')) {
    if (lowerName.includes('mongo') || paramName.length === 24) return 'ObjectId';
    return 'string (id)';
  }
  if (lowerName.includes('uuid')) return 'string (uuid)';
  if (lowerName.includes('slug')) return 'string (slug)';
  if (lowerName.includes('date')) return 'string (date)';
  if (lowerName.includes('page') || lowerName.includes('limit')) return 'number';
  
  return 'string';
}

/**
 * Generates example value for parameter
 */
function generateParamExample(paramName: string): string {
  const lowerName = paramName.toLowerCase();
  
  if (lowerName === 'id' || lowerName.endsWith('id')) return '507f1f77bcf86cd799439011';
  if (lowerName.includes('uuid')) return 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  if (lowerName.includes('slug')) return 'example-slug';
  if (lowerName.includes('date')) return '2025-01-15';
  if (lowerName.includes('email')) return 'user@example.com';
  
  return 'example-value';
}

/**
 * Finds service layer calls from a handler
 */
export function findServiceCalls(handler: Node): ServiceCall[] {
  const calls: ServiceCall[] = [];
  const seen = new Set<string>();
  
  const callExpressions = handler.getDescendantsOfKind(SyntaxKind.CallExpression);
  
  for (const call of callExpressions) {
    const expr = call.getExpression();
    const text = expr.getText();
    
    // Match ServiceName.methodName() pattern
    const serviceMatch = text.match(/(\w+Service)\.(\w+)/);
    if (serviceMatch) {
      const key = `${serviceMatch[1]}.${serviceMatch[2]}`;
      if (!seen.has(key)) {
        seen.add(key);
        calls.push({
          serviceName: serviceMatch[1],
          methodName: serviceMatch[2]
        });
      }
    }
    
    // Match this.serviceInstance.method() pattern
    const thisServiceMatch = text.match(/this\.(\w+)\.(\w+)/);
    if (thisServiceMatch) {
      const key = `${thisServiceMatch[1]}.${thisServiceMatch[2]}`;
      if (!seen.has(key)) {
        seen.add(key);
        calls.push({
          serviceName: thisServiceMatch[1],
          methodName: thisServiceMatch[2]
        });
      }
    }
  }
  
  return calls;
}

/**
 * Extracts query parameters from handler code
 */
export function extractQueryParams(handler: Node): QueryParam[] {
  const params: QueryParam[] = [];
  const seen = new Set<string>();
  
  const propertyAccesses = handler.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
  
  for (const access of propertyAccesses) {
    const text = access.getText();
    
    // Match req.query.paramName
    const queryMatch = text.match(/req\.query\.(\w+)/);
    if (queryMatch && !seen.has(queryMatch[1])) {
      seen.add(queryMatch[1]);
      params.push({
        name: queryMatch[1],
        type: inferQueryParamType(queryMatch[1]),
        required: false,
        example: generateQueryParamExample(queryMatch[1])
      });
    }
  }
  
  // Also check destructuring: const { page, limit } = req.query
  const bindings = handler.getDescendantsOfKind(SyntaxKind.BindingElement);
  for (const binding of bindings) {
    const parent = binding.getParent()?.getParent();
    if (parent && Node.isVariableDeclaration(parent)) {
      const init = parent.getInitializer()?.getText();
      if (init?.includes('req.query')) {
        const name = binding.getName();
        if (!seen.has(name)) {
          seen.add(name);
          params.push({
            name,
            type: inferQueryParamType(name),
            required: false,
            example: generateQueryParamExample(name)
          });
        }
      }
    }
  }
  
  return params;
}

/**
 * Infers type from query parameter name
 */
function inferQueryParamType(paramName: string): string {
  const lowerName = paramName.toLowerCase();
  
  if (lowerName === 'page' || lowerName === 'limit' || lowerName === 'offset' || 
      lowerName === 'skip' || lowerName === 'take' || lowerName.includes('count')) {
    return 'number';
  }
  if (lowerName.includes('sort') || lowerName.includes('order')) return 'string';
  if (lowerName.includes('filter')) return 'string';
  if (lowerName.includes('search') || lowerName === 'q') return 'string';
  if (lowerName.includes('include') || lowerName.includes('expand')) return 'string[]';
  if (lowerName.includes('active') || lowerName.includes('enabled')) return 'boolean';
  
  return 'string';
}

/**
 * Generates example value for query parameter
 */
function generateQueryParamExample(paramName: string): string {
  const lowerName = paramName.toLowerCase();
  
  if (lowerName === 'page') return '1';
  if (lowerName === 'limit' || lowerName === 'take') return '10';
  if (lowerName === 'offset' || lowerName === 'skip') return '0';
  if (lowerName.includes('sort')) return 'createdAt:desc';
  if (lowerName.includes('search') || lowerName === 'q') return 'search term';
  if (lowerName.includes('filter')) return 'status:active';
  
  return 'value';
}

// Helper function to load source file
let cachedProject: Project | null = null;
const fileCache = new Map<string, SourceFile>();

function loadSourceFile(filePath: string): SourceFile | null {
  if (fileCache.has(filePath)) {
    return fileCache.get(filePath)!;
  }
  
  if (!cachedProject) {
    cachedProject = new Project({ skipFileDependencyResolution: true });
  }
  
  try {
    if (!fs.existsSync(filePath)) return null;
    const sourceFile = cachedProject.addSourceFileAtPath(filePath);
    fileCache.set(filePath, sourceFile);
    return sourceFile;
  } catch (e) {
    return null;
  }
}

function resolveModulePath(currentFile: string, moduleSpecifier: string): string | null {
  if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) {
    return null;
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
 * Clears the schema extractor cache
 */
export function clearSchemaCache(): void {
  fileCache.clear();
  cachedProject = null;
}
