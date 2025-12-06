import { Project, SyntaxKind, Node, CallExpression } from 'ts-morph';
import { Route } from '../types';

export function scanRoutes(files: string[]): Route[] {
  const routes: Route[] = [];

  for (const file of files) {
    try {
      const project = new Project();
      const sourceFile = project.addSourceFileAtPath(file);

      // Find all call expressions
      const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

      for (const call of callExpressions) {
        const route = extractRoute(call);
        if (route) {
          routes.push(route);
        }
      }
    } catch (e) {
      // Skip files that can't be parsed
      console.warn(`Could not parse ${file}:`, e);
    }
  }

  return routes;
}

function extractRoute(callExpression: Node): Route | null {
  const call = callExpression as CallExpression;
  const expression = call.getExpression();

  // Check if it's a route definition: app.get, router.post, etc.
  if (!isRouteDefinition(expression)) return null;

  const args = call.getArguments();

  // First arg: path string
  const pathArg = args[0];
  if (!pathArg) return null;

  const path = pathArg.getText().replace(/['"]/g, '');

  // Determine method from call expression
  const method = getMethodFromCall(expression);

  // Remaining args: middleware and handler
  const handlerArg = args[args.length - 1]; // Last arg is handler
  const middleware = args.slice(1, -1).map((a: Node) => a.getText());

  const sourceFile = call.getSourceFile();

  return {
    method,
    path,
    handlerName: handlerArg.getText(),
    handlerFile: sourceFile.getFilePath(),
    middleware,
    sourceLocation: {
      file: sourceFile.getFilePath(),
      line: callExpression.getStartLineNumber()
    }
  };
}

function isRouteDefinition(expression: Node): boolean {
  const text = expression.getText();
  return /\bapp\.(get|post|put|delete|patch)\b/.test(text);
}

function getMethodFromCall(expression: Node): 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' {
  const text = expression.getText();
  const match = text.match(/\bapp\.(get|post|put|delete|patch)\b/i);
  return (match ? match[1].toUpperCase() : 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
}