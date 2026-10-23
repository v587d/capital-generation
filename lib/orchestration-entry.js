import { registerWaitForAgentsTool } from './agents/wait-for-agents.js';
export const name = 'capital-orchestration-tools';
export const inject = ['tools'];
export function apply(ctx) {
    registerWaitForAgentsTool(ctx);
}
