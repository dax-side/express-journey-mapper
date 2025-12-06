import * as fs from 'fs/promises';
import * as path from 'path';
import { Flow } from '../types';

export async function generateJson(flows: Flow[], outputPath: string): Promise<void> {
  const data = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    flows
  };

  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
}