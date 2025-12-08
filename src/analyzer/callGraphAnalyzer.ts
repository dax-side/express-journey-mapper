import { Node, SyntaxKind, CallExpression, SourceFile, PropertyAccessExpression } from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a detected external service call with confidence scoring
 */
export interface DetectedCall {
  type: 'http' | 'database' | 'payment' | 'email' | 'storage' | 'sms' | 'cache' | 'queue' | 'unknown';
  target: string;
  method?: string;
  service?: string;
  confidence: number; // 0.0 - 1.0
  callExpression?: string;
  isInternal?: boolean;
}

/**
 * Represents a detected side effect
 */
export interface DetectedSideEffect {
  type: 'email' | 'queue' | 'cache' | 'file' | 'socket' | 'webhook' | 'notification' | 'sms' | 'analytics';
  description: string;
  confidence: number;
}

/**
 * Known service registry - maps npm packages to service types
 */
const SERVICE_REGISTRY: Record<string, { type: DetectedCall['type']; patterns: string[] }> = {
  // Payment gateways
  'stripe': { type: 'payment', patterns: ['charges', 'customers', 'paymentIntents', 'subscriptions'] },
  'paystack': { type: 'payment', patterns: ['transaction', 'customer', 'charge', 'verify'] },
  '@paystack/paystack-sdk': { type: 'payment', patterns: ['transaction', 'customer'] },
  'flutterwave-node-v3': { type: 'payment', patterns: ['Charge', 'Transaction', 'Payment'] },
  'razorpay': { type: 'payment', patterns: ['orders', 'payments', 'customers'] },
  'braintree': { type: 'payment', patterns: ['transaction', 'customer'] },
  'square': { type: 'payment', patterns: ['paymentsApi', 'ordersApi'] },
  
  // Email services
  '@sendgrid/mail': { type: 'email', patterns: ['send', 'sendMultiple'] },
  'sendgrid': { type: 'email', patterns: ['send'] },
  'nodemailer': { type: 'email', patterns: ['sendMail', 'createTransport'] },
  'mailgun-js': { type: 'email', patterns: ['messages', 'send'] },
  '@mailgun/mailgun-js': { type: 'email', patterns: ['messages', 'send'] },
  'postmark': { type: 'email', patterns: ['sendEmail', 'sendEmailBatch'] },
  '@aws-sdk/client-ses': { type: 'email', patterns: ['SendEmailCommand', 'send'] },
  'resend': { type: 'email', patterns: ['emails', 'send'] },
  
  // File storage
  '@aws-sdk/client-s3': { type: 'storage', patterns: ['PutObjectCommand', 'GetObjectCommand', 'send'] },
  'aws-sdk': { type: 'storage', patterns: ['S3', 'putObject', 'getObject', 'upload'] },
  'cloudinary': { type: 'storage', patterns: ['uploader', 'upload', 'destroy'] },
  '@google-cloud/storage': { type: 'storage', patterns: ['bucket', 'upload', 'file'] },
  'uploadthing': { type: 'storage', patterns: ['uploadFiles', 'createUploadthing'] },
  
  // Databases
  '@prisma/client': { type: 'database', patterns: ['findMany', 'findUnique', 'create', 'update', 'delete'] },
  'prisma': { type: 'database', patterns: ['findMany', 'findUnique', 'create', 'update', 'delete'] },
  'mongoose': { type: 'database', patterns: ['find', 'findOne', 'save', 'create', 'updateOne', 'deleteOne'] },
  'pg': { type: 'database', patterns: ['query', 'connect'] },
  'mysql2': { type: 'database', patterns: ['query', 'execute'] },
  'typeorm': { type: 'database', patterns: ['find', 'save', 'createQueryBuilder', 'getRepository'] },
  'sequelize': { type: 'database', patterns: ['findAll', 'findOne', 'create', 'update', 'destroy'] },
  'knex': { type: 'database', patterns: ['select', 'insert', 'update', 'delete', 'where'] },
  'drizzle-orm': { type: 'database', patterns: ['select', 'insert', 'update', 'delete'] },
  
  // Cache
  'redis': { type: 'cache', patterns: ['get', 'set', 'del', 'hget', 'hset', 'expire'] },
  'ioredis': { type: 'cache', patterns: ['get', 'set', 'del', 'hget', 'hset', 'expire'] },
  '@upstash/redis': { type: 'cache', patterns: ['get', 'set', 'del'] },
  
  // SMS
  'twilio': { type: 'sms', patterns: ['messages', 'create'] },
  'africastalking': { type: 'sms', patterns: ['SMS', 'send'] },
  'nexmo': { type: 'sms', patterns: ['message', 'sendSms'] },
  '@vonage/server-sdk': { type: 'sms', patterns: ['sms', 'send'] },
  
  // Queue/messaging
  'amqplib': { type: 'queue', patterns: ['sendToQueue', 'publish', 'consume'] },
  'bull': { type: 'queue', patterns: ['add', 'process'] },
  'bullmq': { type: 'queue', patterns: ['add', 'process'] },
  '@aws-sdk/client-sqs': { type: 'queue', patterns: ['SendMessageCommand', 'send'] },
  'kafkajs': { type: 'queue', patterns: ['send', 'producer', 'consumer'] },
};

/**
 * Common middleware that should NOT be flagged as external calls
 */
const MIDDLEWARE_WHITELIST = new Set([
  // Express middleware
  'cors', 'helmet', 'morgan', 'compression', 'bodyParser', 'cookieParser',
  'express.json', 'express.urlencoded', 'express.static', 'express.Router',
  'json', 'urlencoded', 'static', 'raw', 'text',
  
  // Auth middleware
  'authenticate', 'authorize', 'auth', 'requireAuth', 'ensureAuthenticated',
  'isAuthenticated', 'isAuthorized', 'passport', 'jwt', 'verifyToken',
  'checkAuth', 'requireLogin', 'protect', 'guard', 'authenticated',
  
  // Validation middleware
  'validate', 'validateRequest', 'validateBody', 'validateParams',
  'validateQuery', 'checkSchema', 'validationResult',
  
  // Rate limiting
  'rateLimit', 'rateLimiter', 'throttle', 'slowDown',
  
  // Error handling
  'errorHandler', 'notFound', 'asyncHandler', 'catchAsync', 'tryCatch',
  
  // Logging
  'logger', 'log', 'requestLogger', 'responseLogger',
  
  // Session
  'session', 'cookieSession', 'expressSession',
  
  // File upload
  'multer', 'upload', 'single', 'array', 'fields',
  
  // CSRF
  'csrf', 'csurf', 'csrfProtection',
  
  // Misc
  'next', 'use', 'Router',
]);

/**
 * Cache for package.json dependencies
 */
let cachedDependencies: Record<string, string> | null = null;
let cachedProjectRoot: string | null = null;

/**
 * Loads and caches project dependencies from package.json
 */
export function loadProjectDependencies(projectRoot: string): Record<string, string> {
  if (cachedDependencies && cachedProjectRoot === projectRoot) {
    return cachedDependencies;
  }
  
  const packageJsonPath = path.join(projectRoot, 'package.json');
  
  try {
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      cachedDependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };
      cachedProjectRoot = projectRoot;
      return cachedDependencies;
    }
  } catch (error) {
    // Ignore parse errors
  }
  
  return {};
}

/**
 * Clears the dependency cache
 */
export function clearDependencyCache(): void {
  cachedDependencies = null;
  cachedProjectRoot = null;
}

/**
 * Builds a service registry based on installed packages
 */
export function buildServiceRegistry(projectRoot: string): Map<string, { type: DetectedCall['type']; patterns: string[] }> {
  const dependencies = loadProjectDependencies(projectRoot);
  const registry = new Map<string, { type: DetectedCall['type']; patterns: string[] }>();
  
  for (const [pkg, info] of Object.entries(SERVICE_REGISTRY)) {
    if (dependencies[pkg]) {
      registry.set(pkg, info);
    }
  }
  
  return registry;
}

/**
 * Analyzes ONLY the handler function body for external calls
 * This is the key fix for Issue #1 (Scope Bleeding)
 */
export function analyzeHandlerCalls(
  handler: Node,
  projectRoot: string
): { calls: DetectedCall[]; sideEffects: DetectedSideEffect[] } {
  const calls: DetectedCall[] = [];
  const sideEffects: DetectedSideEffect[] = [];
  const seen = new Set<string>();
  
  // Get the handler body - this ensures we ONLY analyze executed code
  const handlerBody = getHandlerBody(handler);
  if (!handlerBody) {
    return { calls, sideEffects };
  }
  
  // Get all CALL expressions within the handler body only
  const callExpressions = handlerBody.getDescendantsOfKind(SyntaxKind.CallExpression);
  
  // Load installed packages to know what's a real external service
  const installedServices = buildServiceRegistry(projectRoot);
  
  for (const callExpr of callExpressions) {
    const callInfo = analyzeCallExpression(callExpr, installedServices);
    
    if (callInfo) {
      const key = `${callInfo.type}:${callInfo.target}`;
      if (!seen.has(key)) {
        seen.add(key);
        
        // Check if this is middleware (skip it)
        if (!isMiddlewareCall(callExpr)) {
          calls.push(callInfo);
        }
      }
    }
    
    // Check for side effects
    const sideEffect = detectSideEffect(callExpr);
    if (sideEffect) {
      const key = `${sideEffect.type}:${sideEffect.description}`;
      if (!seen.has(key)) {
        seen.add(key);
        sideEffects.push(sideEffect);
      }
    }
  }
  
  return { calls, sideEffects };
}

/**
 * Gets the body of a handler function (arrow function body or function body)
 */
function getHandlerBody(handler: Node): Node | null {
  // Arrow function: (req, res) => { ... } or (req, res) => expr
  if (handler.getKind() === SyntaxKind.ArrowFunction) {
    const body = handler.getChildAtIndex(handler.getChildCount() - 1);
    return body || null;
  }
  
  // Function expression: function(req, res) { ... }
  if (handler.getKind() === SyntaxKind.FunctionExpression || 
      handler.getKind() === SyntaxKind.FunctionDeclaration) {
    const body = handler.getFirstDescendantByKind(SyntaxKind.Block);
    return body || null;
  }
  
  // Method: methodName(req, res) { ... }
  if (handler.getKind() === SyntaxKind.MethodDeclaration) {
    const body = handler.getFirstDescendantByKind(SyntaxKind.Block);
    return body || null;
  }
  
  // If it's already a block, return it
  if (handler.getKind() === SyntaxKind.Block) {
    return handler;
  }
  
  // Fallback: return the handler itself
  return handler;
}

/**
 * Checks if a call is middleware (should be ignored)
 */
function isMiddlewareCall(callExpr: CallExpression): boolean {
  const text = callExpr.getExpression().getText();
  
  // Extract the function/method name
  const funcName = text.split('.').pop()?.split('(')[0] || text;
  
  if (MIDDLEWARE_WHITELIST.has(funcName)) {
    return true;
  }
  
  // Check if it's a middleware pattern: something(req, res, next)
  const args = callExpr.getArguments();
  if (args.length >= 2) {
    const argTexts = args.map(a => a.getText());
    if (argTexts.includes('req') && argTexts.includes('res')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Analyzes a single call expression to determine if it's an external service call
 */
function analyzeCallExpression(
  callExpr: CallExpression,
  installedServices: Map<string, { type: DetectedCall['type']; patterns: string[] }>
): DetectedCall | null {
  const expr = callExpr.getExpression();
  const fullText = expr.getText();
  
  // Check for HTTP calls first (these are special)
  const httpCall = detectHttpCall(callExpr);
  if (httpCall) {
    return httpCall;
  }
  
  // Check against installed service patterns
  for (const [_pkg, info] of installedServices) {
    for (const pattern of info.patterns) {
      if (fullText.includes(pattern) || fullText.toLowerCase().includes(pattern.toLowerCase())) {
        return {
          type: info.type,
          target: extractTarget(callExpr, info.type),
          method: extractMethodName(fullText),
          confidence: 0.9,
          callExpression: fullText.substring(0, 60)
        };
      }
    }
  }
  
  // Check for database patterns (common across ORMs)
  const dbCall = detectDatabaseCall(callExpr);
  if (dbCall) {
    return dbCall;
  }
  
  // Check for payment patterns
  const paymentCall = detectPaymentCall(callExpr);
  if (paymentCall) {
    return paymentCall;
  }
  
  // Check for email patterns
  const emailCall = detectEmailCall(callExpr);
  if (emailCall) {
    return emailCall;
  }
  
  // Check for storage patterns
  const storageCall = detectStorageCall(callExpr);
  if (storageCall) {
    return storageCall;
  }
  
  return null;
}

/**
 * Detects HTTP calls (axios, fetch, got, etc.)
 */
function detectHttpCall(callExpr: CallExpression): DetectedCall | null {
  const text = callExpr.getText();
  const exprText = callExpr.getExpression().getText();
  
  // Check for common HTTP client patterns
  const httpPatterns = [
    /\b(axios)\s*\.\s*(get|post|put|patch|delete|request)/i,
    /\b(axios)\s*\(/i,
    /\bfetch\s*\(/,
    /\b(got)\s*\.\s*(get|post|put|patch|delete)/i,
    /\b(got)\s*\(/i,
    /\b(superagent)\s*\.\s*(get|post|put|patch|delete)/i,
    /\b(request)\s*\.\s*(get|post|put|patch|delete)/i,
    /\b(ky)\s*\.\s*(get|post|put|patch|delete)/i,
  ];
  
  for (const pattern of httpPatterns) {
    if (pattern.test(exprText) || pattern.test(text)) {
      const target = extractHttpTarget(callExpr);
      
      // Skip internal calls (Issue #8)
      if (isInternalUrl(target)) {
        return null;
      }
      
      return {
        type: 'http',
        target,
        method: extractHttpMethod(text),
        confidence: target.startsWith('http') ? 0.95 : 0.7,
        isInternal: isInternalUrl(target)
      };
    }
  }
  
  return null;
}

/**
 * Checks if a URL is internal (Issue #8)
 */
function isInternalUrl(url: string): boolean {
  // Relative URLs
  if (url.startsWith('/') && !url.startsWith('//')) {
    return true;
  }
  
  // Localhost
  if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0')) {
    return true;
  }
  
  // Internal service names (common in Docker/K8s)
  if (url.match(/^https?:\/\/[a-z0-9-]+:\d+/i) && !url.includes('.')) {
    return true;
  }
  
  return false;
}

/**
 * Extracts HTTP target URL from call
 */
function extractHttpTarget(callExpr: CallExpression): string {
  const args = callExpr.getArguments();
  if (args.length > 0) {
    let url = args[0].getText().replace(/['"`]/g, '');
    
    // Handle template literals
    if (url.includes('${')) {
      url = url.replace(/\$\{[^}]+\}/g, '{dynamic}');
    }
    
    // Truncate long URLs
    return url.length > 60 ? url.substring(0, 60) + '...' : url;
  }
  return 'unknown';
}

/**
 * Extracts HTTP method
 */
function extractHttpMethod(text: string): string {
  const methodMatch = text.match(/\.(get|post|put|patch|delete)\s*\(/i);
  if (methodMatch) {
    return methodMatch[1].toUpperCase();
  }
  
  const configMatch = text.match(/method:\s*['"](\w+)['"]/i);
  if (configMatch) {
    return configMatch[1].toUpperCase();
  }
  
  return 'GET';
}

/**
 * Detects database calls
 */
function detectDatabaseCall(callExpr: CallExpression): DetectedCall | null {
  const text = callExpr.getExpression().getText();
  
  // Prisma patterns
  const prismaMatch = text.match(/(\w+)\.(findMany|findUnique|findFirst|create|update|delete|upsert|aggregate|count|groupBy)/);
  if (prismaMatch) {
    return {
      type: 'database',
      target: prismaMatch[1],
      method: prismaMatch[2],
      confidence: 0.95,
      callExpression: text.substring(0, 50)
    };
  }
  
  // Mongoose patterns
  const mongooseMatch = text.match(/(\w+)\.(find|findOne|findById|save|create|updateOne|updateMany|deleteOne|deleteMany|aggregate)/);
  if (mongooseMatch) {
    return {
      type: 'database',
      target: mongooseMatch[1],
      method: mongooseMatch[2],
      confidence: 0.9,
      callExpression: text.substring(0, 50)
    };
  }
  
  // Generic query pattern
  if (text.match(/\.(query|execute|run)\s*\(/i)) {
    return {
      type: 'database',
      target: 'Database',
      method: 'query',
      confidence: 0.7,
      callExpression: text.substring(0, 50)
    };
  }
  
  return null;
}

/**
 * Detects payment service calls
 */
function detectPaymentCall(callExpr: CallExpression): DetectedCall | null {
  const text = callExpr.getExpression().getText().toLowerCase();
  
  const paymentPatterns = [
    { pattern: /stripe/i, service: 'Stripe' },
    { pattern: /paystack/i, service: 'Paystack' },
    { pattern: /flutterwave/i, service: 'Flutterwave' },
    { pattern: /razorpay/i, service: 'Razorpay' },
    { pattern: /paypal/i, service: 'PayPal' },
    { pattern: /braintree/i, service: 'Braintree' },
    { pattern: /square/i, service: 'Square' },
  ];
  
  for (const { pattern, service } of paymentPatterns) {
    if (pattern.test(text)) {
      return {
        type: 'payment',
        target: extractPaymentOperation(text),
        service,
        confidence: 0.9,
        callExpression: text.substring(0, 50)
      };
    }
  }
  
  return null;
}

/**
 * Extracts payment operation type
 */
function extractPaymentOperation(text: string): string {
  if (text.match(/charge|payment|pay|checkout/i)) return 'Process payment';
  if (text.match(/refund/i)) return 'Process refund';
  if (text.match(/subscription|subscribe/i)) return 'Manage subscription';
  if (text.match(/transfer/i)) return 'Transfer funds';
  if (text.match(/verify|validate/i)) return 'Verify payment';
  if (text.match(/customer/i)) return 'Manage customer';
  return 'Payment operation';
}

/**
 * Detects email service calls
 */
function detectEmailCall(callExpr: CallExpression): DetectedCall | null {
  const text = callExpr.getExpression().getText().toLowerCase();
  
  const emailPatterns = [
    { pattern: /sendgrid/i, service: 'SendGrid' },
    { pattern: /mailgun/i, service: 'Mailgun' },
    { pattern: /nodemailer/i, service: 'Nodemailer' },
    { pattern: /postmark/i, service: 'Postmark' },
    { pattern: /resend/i, service: 'Resend' },
    { pattern: /\bses\b/i, service: 'AWS SES' },
    { pattern: /sendmail|sendemail/i, service: 'Email' },
  ];
  
  for (const { pattern, service } of emailPatterns) {
    if (pattern.test(text)) {
      return {
        type: 'email',
        target: 'Send email',
        service,
        confidence: 0.9,
        callExpression: text.substring(0, 50)
      };
    }
  }
  
  return null;
}

/**
 * Detects storage service calls
 */
function detectStorageCall(callExpr: CallExpression): DetectedCall | null {
  const text = callExpr.getExpression().getText().toLowerCase();
  
  const storagePatterns = [
    { pattern: /s3|aws.*upload|putobject/i, service: 'AWS S3' },
    { pattern: /cloudinary/i, service: 'Cloudinary' },
    { pattern: /gcs|google.*storage/i, service: 'Google Cloud Storage' },
    { pattern: /uploadthing/i, service: 'UploadThing' },
    { pattern: /minio/i, service: 'MinIO' },
  ];
  
  for (const { pattern, service } of storagePatterns) {
    if (pattern.test(text)) {
      return {
        type: 'storage',
        target: 'File storage',
        service,
        confidence: 0.9,
        callExpression: text.substring(0, 50)
      };
    }
  }
  
  return null;
}

/**
 * Detects side effects from call expressions
 */
function detectSideEffect(callExpr: CallExpression): DetectedSideEffect | null {
  const text = callExpr.getExpression().getText().toLowerCase();
  const fullText = callExpr.getText().toLowerCase();
  
  // Socket/realtime events
  if (text.match(/io\.emit|socket\.emit|broadcast|pusher|ably/) ||
      fullText.match(/\.emit\s*\(\s*['"`]/)) {
    return {
      type: 'socket',
      description: 'Emits realtime event',
      confidence: 0.9
    };
  }
  
  // Queue operations
  if (text.match(/queue\.add|publish|sendtoqueue|producer\.send/)) {
    return {
      type: 'queue',
      description: 'Publishes message to queue',
      confidence: 0.9
    };
  }
  
  // Cache operations
  if (text.match(/cache\.set|redis\.set|cache\.del|redis\.del|cache\.invalidate/)) {
    return {
      type: 'cache',
      description: 'Updates cache',
      confidence: 0.9
    };
  }
  
  // File operations
  if (text.match(/writefile|createwritestream|upload\.single|uploader\.upload/)) {
    return {
      type: 'file',
      description: 'Writes to file/storage',
      confidence: 0.85
    };
  }
  
  // Webhook triggers
  if (text.match(/webhook|callback/) && fullText.match(/post|send|trigger/)) {
    return {
      type: 'webhook',
      description: 'Triggers webhook',
      confidence: 0.75
    };
  }
  
  // Push notifications
  if (text.match(/fcm|firebase.*messaging|apns|onesignal|expo.*push/)) {
    return {
      type: 'notification',
      description: 'Sends push notification',
      confidence: 0.9
    };
  }
  
  // Analytics
  if (text.match(/analytics\.track|segment\.track|mixpanel\.track|amplitude/)) {
    return {
      type: 'analytics',
      description: 'Tracks analytics event',
      confidence: 0.85
    };
  }
  
  return null;
}

/**
 * Extracts target from call expression based on type
 */
function extractTarget(callExpr: CallExpression, type: DetectedCall['type']): string {
  const text = callExpr.getExpression().getText();
  
  switch (type) {
    case 'database':
      const dbMatch = text.match(/(\w+)\.(find|create|update|delete)/);
      return dbMatch ? dbMatch[1] : 'Database';
      
    case 'payment':
      return extractPaymentOperation(text);
      
    case 'email':
      return 'Send email';
      
    case 'storage':
      return 'File storage';
      
    case 'cache':
      return 'Cache operation';
      
    case 'queue':
      return 'Queue message';
      
    default:
      return text.substring(0, 40);
  }
}

/**
 * Extracts method name from call text
 */
function extractMethodName(text: string): string {
  const methodMatch = text.match(/\.(\w+)\s*$/);
  return methodMatch ? methodMatch[1] : 'unknown';
}
