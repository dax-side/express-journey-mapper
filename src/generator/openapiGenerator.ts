import * as fs from 'fs/promises';
import * as path from 'path';
import { Flow, FlowStep, ValidationSchema, FieldSchema, ResponseInfo, PathParam, QueryParam } from '../types';

interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers?: { url: string; description: string }[];
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components: {
    schemas: Record<string, OpenAPISchema>;
    securitySchemes?: Record<string, OpenAPISecurityScheme>;
  };
  tags: { name: string; description: string }[];
}

interface OpenAPIOperation {
  tags: string[];
  summary: string;
  description?: string;
  operationId: string;
  parameters?: OpenAPIParameter[];
  requestBody?: {
    required: boolean;
    content: Record<string, { schema: OpenAPISchema }>;
  };
  responses: Record<string, OpenAPIResponse>;
  security?: Record<string, string[]>[];
}

interface OpenAPIParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  description?: string;
  schema: {
    type: string;
    example?: string;
  };
}

interface OpenAPIResponse {
  description: string;
  content?: Record<string, { schema: OpenAPISchema; example?: unknown }>;
}

interface OpenAPISchema {
  type: string;
  properties?: Record<string, OpenAPISchemaProperty>;
  required?: string[];
  items?: OpenAPISchema;
  example?: unknown;
}

interface OpenAPISchemaProperty {
  type: string;
  description?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: string[];
  example?: unknown;
}

interface OpenAPISecurityScheme {
  type: string;
  scheme?: string;
  bearerFormat?: string;
  in?: string;
  name?: string;
}

/**
 * Generates OpenAPI 3.0 specification from analyzed flows
 */
export async function generateOpenAPI(
  flows: Flow[],
  outputPath: string,
  options: {
    title?: string;
    version?: string;
    description?: string;
    serverUrl?: string;
  } = {}
): Promise<void> {
  const spec: OpenAPISpec = {
    openapi: '3.0.3',
    info: {
      title: options.title || 'API Documentation',
      version: options.version || '1.0.0',
      description: options.description || 'Auto-generated API documentation from Express.js routes'
    },
    servers: options.serverUrl ? [{ url: options.serverUrl, description: 'API Server' }] : undefined,
    paths: {},
    components: {
      schemas: {},
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    },
    tags: []
  };

  // Generate tags from flows
  for (const flow of flows) {
    spec.tags.push({
      name: flow.id,
      description: flow.description || `${flow.title} endpoints`
    });
  }

  // Generate paths from flow steps
  for (const flow of flows) {
    for (const step of flow.steps) {
      addPathFromStep(spec, step, flow.id);
    }
  }

  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  // Write based on file extension
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    const yaml = convertToYaml(spec);
    await fs.writeFile(outputPath, yaml);
  } else {
    await fs.writeFile(outputPath, JSON.stringify(spec, null, 2));
  }
}

/**
 * Adds a path operation from a flow step
 */
function addPathFromStep(spec: OpenAPISpec, step: FlowStep, tag: string): void {
  // Parse endpoint: "GET /api/users/:id"
  const [method, ...pathParts] = step.endpoint.split(' ');
  const originalPath = pathParts.join(' ').trim();
  
  // Convert Express path params to OpenAPI format: :id -> {id}
  const openApiPath = originalPath.replace(/:(\w+)/g, '{$1}');
  
  if (!spec.paths[openApiPath]) {
    spec.paths[openApiPath] = {};
  }

  const httpMethod = method.toLowerCase();
  if (httpMethod === 'all') return; // Skip ALL method

  const operation: OpenAPIOperation = {
    tags: [tag],
    summary: generateSummary(step),
    description: step.description,
    operationId: generateOperationId(method, originalPath),
    parameters: [],
    responses: {}
  };

  // Add path parameters
  if (step.pathParams && step.pathParams.length > 0) {
    for (const param of step.pathParams) {
      operation.parameters!.push(convertPathParam(param));
    }
  }

  // Add query parameters
  if (step.queryParams && step.queryParams.length > 0) {
    for (const param of step.queryParams) {
      operation.parameters!.push(convertQueryParam(param));
    }
  }

  // Add request body if present
  if (step.requestBody && step.requestBody.fields && step.requestBody.fields.length > 0) {
    const schemaName = generateSchemaName(method, originalPath, 'Request');
    const schema = convertValidationSchema(step.requestBody);
    spec.components.schemas[schemaName] = schema;
    
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${schemaName}` } as unknown as OpenAPISchema
        }
      }
    };
  }

  // Add responses
  if (step.responses && step.responses.length > 0) {
    for (const response of step.responses) {
      operation.responses[String(response.statusCode)] = convertResponse(response, spec, method, originalPath);
    }
  } else {
    // Default response
    operation.responses['200'] = {
      description: 'Successful response'
    };
  }

  // Add security requirement if auth is required
  if (step.authRequired) {
    operation.security = [{ bearerAuth: [] }];
  }

  // Remove empty parameters array
  if (operation.parameters!.length === 0) {
    delete operation.parameters;
  }

  spec.paths[openApiPath][httpMethod] = operation;
}

/**
 * Generates a summary from the step
 */
function generateSummary(step: FlowStep): string {
  const [method, ...pathParts] = step.endpoint.split(' ');
  const pathStr = pathParts.join(' ').trim();
  
  // Extract the resource name from the path
  const segments = pathStr.split('/').filter(s => s && !s.startsWith(':') && s !== 'api');
  const resource = segments[segments.length - 1] || 'resource';
  
  const methodActions: Record<string, string> = {
    GET: 'Get',
    POST: 'Create',
    PUT: 'Update',
    PATCH: 'Update',
    DELETE: 'Delete'
  };
  
  const action = methodActions[method] || method;
  return `${action} ${resource}`;
}

/**
 * Generates an operation ID from method and path
 */
function generateOperationId(method: string, path: string): string {
  // Convert /api/users/:id to api_users_id
  const pathPart = path
    .replace(/^\//, '')
    .replace(/\//g, '_')
    .replace(/:/g, '')
    .replace(/[^a-zA-Z0-9_]/g, '');
  
  return `${method.toLowerCase()}_${pathPart}`;
}

/**
 * Generates a schema name from method and path
 */
function generateSchemaName(method: string, path: string, suffix: string): string {
  // Include method for request schemas to differentiate POST vs PUT
  const methodPart = suffix === 'Request' ? 
    method.charAt(0).toUpperCase() + method.slice(1).toLowerCase() : '';
  
  const pathPart = path
    .split('/')
    .filter(s => s && !s.startsWith(':') && s !== 'api')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
  
  return `${pathPart}${methodPart}${suffix}`;
}

/**
 * Converts path parameter to OpenAPI format
 */
function convertPathParam(param: PathParam): OpenAPIParameter {
  return {
    name: param.name,
    in: 'path',
    required: true,
    description: `Path parameter: ${param.name}`,
    schema: {
      type: mapTypeToOpenAPI(param.type),
      example: param.example
    }
  };
}

/**
 * Converts query parameter to OpenAPI format
 */
function convertQueryParam(param: QueryParam): OpenAPIParameter {
  return {
    name: param.name,
    in: 'query',
    required: param.required || false,
    description: `Query parameter: ${param.name}`,
    schema: {
      type: mapTypeToOpenAPI(param.type),
      example: param.example
    }
  };
}

/**
 * Converts validation schema to OpenAPI schema
 */
function convertValidationSchema(schema: ValidationSchema): OpenAPISchema {
  const properties: Record<string, OpenAPISchemaProperty> = {};
  const required: string[] = [];

  for (const field of schema.fields) {
    properties[field.name] = convertFieldSchema(field);
    if (field.required) {
      required.push(field.name);
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined
  };
}

/**
 * Converts a field schema to OpenAPI property
 */
function convertFieldSchema(field: FieldSchema): OpenAPISchemaProperty {
  const prop: OpenAPISchemaProperty = {
    type: mapTypeToOpenAPI(field.type),
    description: field.description
  };

  // Parse validation rules
  if (field.validation) {
    for (const rule of field.validation) {
      if (rule.startsWith('min:')) {
        const val = parseInt(rule.split(':')[1].trim(), 10);
        if (prop.type === 'string') {
          prop.minLength = val;
        } else {
          prop.minimum = val;
        }
      }
      if (rule.startsWith('max:')) {
        const val = parseInt(rule.split(':')[1].trim(), 10);
        if (prop.type === 'string') {
          prop.maxLength = val;
        } else {
          prop.maximum = val;
        }
      }
      if (rule.includes('email')) {
        prop.format = 'email';
      }
      if (rule.includes('URL') || rule.includes('url')) {
        prop.format = 'uri';
      }
      if (rule.includes('UUID') || rule.includes('uuid')) {
        prop.format = 'uuid';
      }
      if (rule.startsWith('pattern:')) {
        prop.pattern = rule.split(':')[1].trim();
      }
      if (rule.startsWith('oneOf:')) {
        const values = rule.split(':')[1].trim().replace(/[\[\]]/g, '').split(',').map(s => s.trim());
        prop.enum = values;
      }
    }
  }

  if (field.example) {
    prop.example = field.example;
  }

  return prop;
}

/**
 * Converts response to OpenAPI format
 */
function convertResponse(
  response: ResponseInfo,
  spec: OpenAPISpec,
  method: string,
  path: string
): OpenAPIResponse {
  const result: OpenAPIResponse = {
    description: response.description
  };

  if (response.schema) {
    // Try to parse as JSON to create proper schema
    try {
      const schemaName = generateSchemaName(method, path, `Response${response.statusCode}`);
      const parsed = parseSchemaString(response.schema);
      spec.components.schemas[schemaName] = parsed;
      
      result.content = {
        'application/json': {
          schema: { $ref: `#/components/schemas/${schemaName}` } as unknown as OpenAPISchema,
          example: response.example ? tryParseJson(response.example) : undefined
        }
      };
    } catch {
      // If parsing fails, use inline example
      result.content = {
        'application/json': {
          schema: { type: 'object' },
          example: response.example || response.schema
        }
      };
    }
  }

  return result;
}

/**
 * Tries to parse a string as JSON
 */
function tryParseJson(str: string): unknown {
  try {
    // Replace single quotes with double quotes for JSON parsing
    const jsonStr = str.replace(/'/g, '"').replace(/(\w+):/g, '"$1":');
    return JSON.parse(jsonStr);
  } catch {
    return str;
  }
}

/**
 * Parses a schema string into OpenAPI schema
 */
function parseSchemaString(schema: string): OpenAPISchema {
  // Simple parsing for common patterns
  const properties: Record<string, OpenAPISchemaProperty> = {};
  
  // Match key: value patterns
  const fieldRegex = /(\w+)\s*:\s*(['"]([^'"]+)['"]|(\d+)|(\w+))/g;
  let match;
  
  while ((match = fieldRegex.exec(schema)) !== null) {
    const [, name, value] = match;
    properties[name] = {
      type: inferTypeFromValue(value)
    };
  }

  return {
    type: 'object',
    properties: Object.keys(properties).length > 0 ? properties : undefined
  };
}

/**
 * Infers OpenAPI type from a value
 */
function inferTypeFromValue(value: string): string {
  if (value.match(/^\d+$/)) return 'integer';
  if (value.match(/^\d+\.\d+$/)) return 'number';
  if (value === 'true' || value === 'false') return 'boolean';
  if (value.startsWith('[')) return 'array';
  if (value.startsWith('{')) return 'object';
  return 'string';
}

/**
 * Maps internal types to OpenAPI types
 */
function mapTypeToOpenAPI(type: string): string {
  const lowerType = type.toLowerCase();
  
  if (lowerType.includes('number') || lowerType.includes('int') || lowerType.includes('float')) {
    return lowerType.includes('int') ? 'integer' : 'number';
  }
  if (lowerType.includes('bool')) return 'boolean';
  if (lowerType.includes('array')) return 'array';
  if (lowerType.includes('object')) return 'object';
  if (lowerType.includes('date')) return 'string'; // with format: date-time
  
  return 'string';
}

/**
 * Converts OpenAPI spec to YAML format
 */
function convertToYaml(obj: unknown, indent: number = 0): string {
  const spaces = '  '.repeat(indent);
  
  if (obj === null || obj === undefined) {
    return 'null';
  }
  
  if (typeof obj === 'string') {
    // Quote strings that need it
    if (obj.includes(':') || obj.includes('#') || obj.includes("'") || obj.includes('"') || obj.match(/^\d/)) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }
  
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj);
  }
  
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => {
      const value = convertToYaml(item, indent + 1);
      if (typeof item === 'object' && item !== null) {
        return `\n${spaces}- ${value.trim()}`;
      }
      return `\n${spaces}- ${value}`;
    }).join('');
  }
  
  if (typeof obj === 'object') {
    const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    
    return entries.map(([key, value]) => {
      const yamlValue = convertToYaml(value, indent + 1);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return `\n${spaces}${key}:${yamlValue}`;
      } else if (Array.isArray(value)) {
        return `\n${spaces}${key}:${yamlValue}`;
      }
      return `\n${spaces}${key}: ${yamlValue}`;
    }).join('');
  }
  
  return String(obj);
}
