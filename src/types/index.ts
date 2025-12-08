export interface ProjectScannerOptions {
  rootPath: string;
  entryPoints?: string[];
  exclude?: string[];
}

export interface ScannedProject {
  sourceFiles: string[];
  entryPoint: string;
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL';
  path: string;
  handlerName: string;
  handlerFile: string;
  middleware: string[];
  sourceLocation: {
    file: string;
    line: number;
  };
}

/** Detailed field schema for request/response */
export interface FieldSchema {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  validation?: string[];  // e.g., ['min: 100', 'max: 1000']
  example?: string;
}

/** Validation schema extracted from Joi/Zod/express-validator */
export interface ValidationSchema {
  source: 'joi' | 'zod' | 'express-validator' | 'inferred';
  fields: FieldSchema[];
  rawSchema?: string;
}

/** Middleware information for a route */
export interface MiddlewareInfo {
  name: string;
  type: 'auth' | 'validation' | 'rateLimit' | 'upload' | 'cors' | 'unknown';
  details?: string;  // e.g., 'JWT required', 'admin role'
}

/** Service call traced from controller */
export interface ServiceCall {
  serviceName: string;
  methodName: string;
  file?: string;
}

/** Path parameter from URL */
export interface PathParam {
  name: string;
  type: string;
  example?: string;
}

/** Query parameter extracted from req.query usage */
export interface QueryParam {
  name: string;
  type: string;
  required?: boolean;
  example?: string;
}

/** Response status and shape */
export interface ResponseInfo {
  statusCode: number;
  description: string;
  schema?: string;
  example?: string;
}

export interface HandlerAnalysis {
  endpoint: string;
  description: string;
  
  // Enhanced request info
  pathParams: PathParam[];
  queryParams: QueryParam[];
  requestBody: ValidationSchema | null;
  
  // Enhanced response info
  responses: ResponseInfo[];
  
  // Middleware chain
  middlewareChain: MiddlewareInfo[];
  authRequired: boolean;
  authDetails?: string;  // e.g., 'JWT', 'admin role required'
  
  // Service layer
  serviceCalls: ServiceCall[];
  
  // External dependencies
  externalCalls: ExternalCall[];
  sideEffects: SideEffect[];
  
  // Legacy compat
  dataIn: string;
  dataOut: string;
  outcomes: Outcome[];
}

export interface ExternalCall {
  type: 'http' | 'database' | 'queue' | 'email' | 'payment' | 'storage' | 'sms' | 'cache' | 'unknown';
  target: string;
  method?: string;
  service?: string;  // e.g., 'Stripe', 'SendGrid', 'S3'
}

export interface SideEffect {
  type: 'email' | 'queue' | 'cache' | 'file' | 'socket' | 'webhook' | 'notification' | 'sms' | 'analytics';
  description: string;
}

export interface Outcome {
  type: 'success' | 'error';
  statusCode: number;
  nextStep?: string;
  description: string;
}

export interface Flow {
  id: string;
  title: string;
  icon: string;
  description: string;
  steps: FlowStep[];
}

export interface FlowStep {
  step: number;
  action: string;
  endpoint: string;
  description: string;
  
  // Enhanced request info
  pathParams?: PathParam[];
  queryParams?: QueryParam[];
  requestBody?: ValidationSchema | null;
  
  // Enhanced response info  
  responses?: ResponseInfo[];
  
  // Middleware chain
  middlewareChain?: MiddlewareInfo[];
  authRequired?: boolean;
  authDetails?: string;
  
  // Service dependencies
  serviceCalls?: ServiceCall[];
  externalCalls?: ExternalCall[];
  sideEffects?: SideEffect[];
  
  // Legacy compat
  dataIn: string;
  dataOut: string;
  externalCall?: string;
  sideEffect?: string;
  outcomes: {
    type: 'success' | 'error';
    next: string;
    description: string;
  }[];
}

export interface FlowConfig {
  flows: {
    [key: string]: {
      title: string;
      icon?: string;
      description?: string;
      steps: {
        endpoint: string;
        description?: string;
        successMessage?: string;
        errorMessages?: { [key: number]: string };
      }[];
    };
  };
}