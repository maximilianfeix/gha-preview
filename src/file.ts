export type WorkflowFileError = 'extension' | 'size';

export function validateWorkflowFile(
  name: string,
  size: number,
): WorkflowFileError | undefined {
  if (!/\.ya?ml$/i.test(name)) return 'extension';
  if (size > 1024 * 1024) return 'size';
}
