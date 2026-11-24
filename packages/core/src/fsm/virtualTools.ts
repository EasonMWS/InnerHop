import type { CanonicalTool } from '../protocols/normalized.js';

export const VIRTUAL_HANDOFF_TOOL_NAME = 'orchestrator_handoff';
export const VIRTUAL_ESCALATE_TOOL_NAME = 'orchestrator_escalate';

export const VIRTUAL_TOOL_NAMES = new Set([
  VIRTUAL_HANDOFF_TOOL_NAME,
  VIRTUAL_ESCALATE_TOOL_NAME,
]);

export const ORCHESTRATOR_HANDOFF_TOOL: CanonicalTool = {
  name: VIRTUAL_HANDOFF_TOOL_NAME,
  description:
    'Hand off execution to the fast Executor model once your implementation plan is finalized. ' +
    'Do NOT call this for pure Q&A or read-only explanations — just answer directly. ' +
    'For tiny settled follow-ups, call this immediately with a 1-2 sentence plan.',
  inputSchema: {
    type: 'object',
    properties: {
      plan: {
        type: 'string',
        description:
          'Concise, ordered implementation plan naming target files, symbols, edge cases, and verification commands.',
      },
      replan_if: {
        type: 'string',
        description:
          'Explicit conditions under which the Executor must stop and escalate back to the Planner.',
      },
      summary: {
        type: 'string',
        description: 'Short 1-line summary of the plan for the user dashboard.',
      },
    },
    required: ['plan'],
  },
};

export const ORCHESTRATOR_ESCALATE_TOOL: CanonicalTool = {
  name: VIRTUAL_ESCALATE_TOOL_NAME,
  description:
    'Return control to the strong Planner model when you hit an unexpected codebase assumption, ' +
    'repeated verification failure, missing dependency, or a design decision not covered by the active plan.',
  inputSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Why the active plan cannot proceed without Planner review.',
      },
      progress_report: {
        type: 'string',
        description: 'What has been completed, what failed, and what remains.',
      },
    },
    required: ['reason', 'progress_report'],
  },
};
