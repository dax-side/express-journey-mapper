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
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  handlerName: string;
  handlerFile: string;
  middleware: string[];
  sourceLocation: {
    file: string;
    line: number;
  };
}

export interface HandlerAnalysis {
  endpoint: string;
  description: string;
  dataIn: string;
  dataOut: string;
  externalCalls: ExternalCall[];
  sideEffects: SideEffect[];
  outcomes: Outcome[];
}

export interface ExternalCall {
  type: 'http' | 'database' | 'queue' | 'email';
  target: string;
  method?: string;
}

export interface SideEffect {
  type: 'email' | 'queue' | 'cache' | 'file';
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