import type { CanonicalTool } from '../protocols/normalized.js';
import type { HarnessId } from '../types.js';

const WRITE_TOOL_NAMES = new Set([
  // Claude Code
  'edit',
  'multiedit',
  'write',
  'notebookedit',
  'todo_write',
  // Codex / OpenAI
  'apply_patch',
  'shell',
  'container_exec',
  'exec_command',
  'write_stdin',
  // Cline / Roo Code / OpenCode / Antigravity / Aider / Generic
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
  'str_replace_editor',
  'str_replace_based_edit_tool',
  'create_file',
  'edit_file',
  'delete_file',
  'insert_edit',
  'patch_file',
  'save_file',
  'write_file',
  // Bash/Terminal tools (blocked during strict read-only planning unless explicitly named read-only)
  'bash',
  'execute_command',
  'run_command',
  'run_shell_command',
  'terminal',
]);

const WRITE_NAME_PATTERNS = [
  /^write_/i,
  /^edit_/i,
  /^create_/i,
  /^delete_/i,
  /^remove_/i,
  /^patch_/i,
  /^replace_/i,
  /^apply_patch/i,
  /^insert_/i,
  /_edit$/i,
  /_write$/i,
];

export function isWriteTool(tool: CanonicalTool): boolean {
  const lower = tool.name.toLowerCase();
  if (WRITE_TOOL_NAMES.has(lower)) return true;
  return WRITE_NAME_PATTERNS.some((re) => re.test(lower));
}

export function filterReadOnlyTools(tools: CanonicalTool[]): CanonicalTool[] {
  return tools.filter((t) => !isWriteTool(t));
}

export function detectHarnessHint(
  systemText: string,
  tools: CanonicalTool[],
): HarnessId | 'generic' {
  const sysLower = systemText.toLowerCase();
  const names = new Set(tools.map((t) => t.name.toLowerCase()));

  if (sysLower.includes('claude code') || (names.has('multiedit') && names.has('glob'))) {
    return 'claude-code';
  }
  if (sysLower.includes('codex') || names.has('apply_patch')) {
    return 'codex';
  }
  if (sysLower.includes('opencode') || (names.has('todowrite') && names.has('bash'))) {
    return 'opencode';
  }
  if (sysLower.includes('deepseek harness') || /\bdsh\b/.test(sysLower)) {
    return 'dsh';
  }
  if (sysLower.includes('roo code') || sysLower.includes('roocode')) {
    return 'roo-code';
  }
  if (sysLower.includes('cline')) {
    return 'cline';
  }
  if (sysLower.includes('cursor')) {
    return 'cursor';
  }
  if (sysLower.includes('aider')) {
    return 'aider';
  }
  return 'generic';
}
