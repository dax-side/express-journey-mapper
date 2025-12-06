import * as fs from 'fs/promises';
import * as path from 'path';
import { Flow } from '../types';

export async function generateMarkdown(flows: Flow[], outputPath: string): Promise<void> {
  let md = '# API User Journeys\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += '---\n\n';

  for (const flow of flows) {
    const flowTitle = flow.icon ? `${flow.icon} ${flow.title}` : flow.title;
    md += `## ${flowTitle}\n\n`;
    md += `${flow.description}\n\n`;

    for (const step of flow.steps) {
      md += `### Step ${step.step}: ${step.action}\n\n`;
      md += `**Endpoint:** \`${step.endpoint}\`\n\n`;
      md += `${step.description}\n\n`;

      md += `**Request Data:**\n\`\`\`json\n${step.dataIn}\n\`\`\`\n\n`;
      md += `**Response Data:**\n\`\`\`json\n${step.dataOut}\n\`\`\`\n\n`;

      md += `**Outcomes:**\n`;
      for (const outcome of step.outcomes) {
        const indicator = outcome.type === 'success' ? '[SUCCESS]' : '[ERROR]';
        md += `- ${indicator} **${outcome.type}**: ${outcome.description} → ${outcome.next}\n`;
      }
      md += '\n';
    }

    md += '---\n\n';
  }

  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(outputPath, md);
}