import { Route, HandlerAnalysis, Flow, FlowStep, FlowConfig } from '../types';

export function buildFlows(routes: Route[], analyses: HandlerAnalysis[], config?: FlowConfig): Flow[] {
  if (config) {
    return buildFlowsFromConfig(routes, analyses, config);
  }

  return autoDetectFlows(routes, analyses);
}

function autoDetectFlows(routes: Route[], analyses: HandlerAnalysis[]): Flow[] {
  const flowMap = new Map<string, { routes: Route[], analyses: HandlerAnalysis[] }>();

  // Group by path prefix
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const analysis = analyses[i];
    const prefix = extractPrefix(route.path);

    if (!flowMap.has(prefix)) {
      flowMap.set(prefix, { routes: [], analyses: [] });
    }
    flowMap.get(prefix)!.routes.push(route);
    flowMap.get(prefix)!.analyses.push(analysis);
  }

  const flows: Flow[] = [];
  for (const [prefix, { routes: flowRoutes, analyses: flowAnalyses }] of flowMap) {
    const steps = orderSteps(flowRoutes, flowAnalyses);
    const titleCase = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    flows.push({
      id: prefix,
      title: `${titleCase} Flow`,
      icon: '', // No icon for auto-detected flows
      description: `User journey for ${prefix} operations`,
      steps
    });
  }

  return flows;
}

function extractPrefix(path: string): string {
  // /api/auth/login -> 'auth'
  // /checkout/payment -> 'checkout'
  const parts = path.split('/').filter(p => p && p !== 'api');
  return parts[0] || 'general';
}

function orderSteps(routes: Route[], analyses: HandlerAnalysis[]): FlowStep[] {
  // Simple ordering: sort by path complexity
  const combined = routes.map((route, i) => ({ route, analysis: analyses[i] }));

  combined.sort((a, b) => {
    const aComplexity = a.route.path.split('/').length;
    const bComplexity = b.route.path.split('/').length;
    return aComplexity - bComplexity;
  });

  return combined.map(({ route, analysis }, index) => createFlowStep(analysis, index + 1));
}

function createFlowStep(analysis: HandlerAnalysis, stepNumber: number): FlowStep {
  return {
    step: stepNumber,
    action: analysis.endpoint,
    endpoint: analysis.endpoint,
    description: analysis.description || `Step ${stepNumber}`,
    dataIn: analysis.dataIn,
    dataOut: analysis.dataOut,
    externalCall: analysis.externalCalls.length > 0 ? analysis.externalCalls[0].target : undefined,
    sideEffect: analysis.sideEffects.length > 0 ? analysis.sideEffects[0].description : undefined,
    outcomes: analysis.outcomes.map(o => ({
      type: o.type,
      next: o.nextStep || (o.type === 'success' ? `Step ${stepNumber + 1}` : 'End'),
      description: o.description
    }))
  };
}

function buildFlowsFromConfig(
  routes: Route[],
  analyses: HandlerAnalysis[],
  config: FlowConfig
): Flow[] {
  const flows: Flow[] = [];

  for (const [flowId, flowConfig] of Object.entries(config.flows)) {
    const steps: FlowStep[] = [];

    for (const stepConfig of flowConfig.steps) {
      const analysis = analyses.find(a => a.endpoint === stepConfig.endpoint);
      if (!analysis) continue;

      // Merge config with analysis
      const step = createFlowStep(analysis, steps.length + 1);

      // Override with config values
      if (stepConfig.description) step.description = stepConfig.description;
      if (stepConfig.successMessage) {
        const successOutcome = step.outcomes.find(o => o.type === 'success');
        if (successOutcome) successOutcome.description = stepConfig.successMessage;
      }

      steps.push(step);
    }

    flows.push({
      id: flowId,
      title: flowConfig.title,
      icon: flowConfig.icon || '',
      description: flowConfig.description || '',
      steps
    });
  }

  return flows;
}