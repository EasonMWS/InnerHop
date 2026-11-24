import type { SessionState } from '../types.js';
import { VIRTUAL_ESCALATE_TOOL_NAME, VIRTUAL_HANDOFF_TOOL_NAME } from './virtualTools.js';

export function buildPlannerSystemAddendum(session: SessionState): string {
  const lines: string[] = [
    '<innerhop_role phase="PLANNING">',
    'You are the ARCHITECT / PLANNER in a dual-model InnerHop loop (Planner designs read-only -> Executor implements -> automatic re-plan on friction).',
    'Rules for PLANNING phase:',
    '1. Only investigate using read-only tools. Write/edit tools are intentionally disabled in this phase.',
    `2. If the user is asking a pure question or explanation that needs no code edits, answer directly in prose without calling \`${VIRTUAL_HANDOFF_TOOL_NAME}\`.`,
    `3. For tiny, settled follow-ups (e.g. a quick variable rename or re-running a check), skip heavy exploration and call \`${VIRTUAL_HANDOFF_TOOL_NAME}\` immediately with a 1-2 sentence plan.`,
    `4. For non-trivial implementation tasks, inspect only the relevant files, design a concrete ordered plan (files, symbols, behavior, verification command) plus clear \`replan_if\` triggers, and then call \`${VIRTUAL_HANDOFF_TOOL_NAME}\` to hand off execution.`,
    '5. Never tell the user to switch models manually; calling the handoff tool seamlessly transfers this same session to the Executor.',
  ];

  if (session.reviewReason) {
    lines.push('');
    lines.push('[PLAN REVIEW TRIGGERED]');
    lines.push(`Review reason: ${session.reviewReason}`);
    if (session.activePlan) {
      lines.push(`Previous plan (v${session.planVersion}):\n${session.activePlan}`);
    }
    if (session.lastErrorSummary) {
      lines.push(`Execution friction / escalation report:\n${session.lastErrorSummary}`);
    }
    lines.push(
      `Inspect the latest tool results or user message, decide whether to revise the plan, and call \`${VIRTUAL_HANDOFF_TOOL_NAME}\` when ready to resume execution (or answer directly if no further edits are needed).`,
    );
  }

  lines.push('</innerhop_role>');
  return lines.join('\n');
}

export function buildExecutorSystemAddendum(session: SessionState): string {
  const lines: string[] = [
    '<innerhop_role phase="EXECUTING">',
    'You are the EXECUTOR in a dual-model InnerHop loop. The Architect has finalized the plan below.',
    'Rules for EXECUTING phase:',
    '1. Follow <active_plan> faithfully in order and verify using the checks it specifies.',
    '2. Handle minor local fixes yourself (missing import, small path adjustment, one retry).',
    `3. Do NOT improvise new architecture or guess past repeated failures. Immediately call \`${VIRTUAL_ESCALATE_TOOL_NAME}\` if:`,
    '   - an assumption in the plan is false or a required file/API behaves differently,',
    '   - you need a design choice the plan did not specify,',
    '   - any <replan_if> condition occurs, or verification fails twice.',
    `<active_plan version="${session.planVersion}">`,
    session.activePlan ?? '(Proceed carefully with the user request.)',
    '</active_plan>',
  ];

  if (session.replanIf) {
    lines.push(`<replan_if>\n${session.replanIf}\n</replan_if>`);
  }
  lines.push('</innerhop_role>');
  return lines.join('\n');
}
