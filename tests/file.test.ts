import { describe, expect, it } from 'vitest';
import { validateWorkflowFile } from '../src/file.ts';

describe('workflow file validation', () => {
  it('accepts YAML workflow files regardless of extension case', () => {
    expect(validateWorkflowFile('build.yml', 100)).toBeUndefined();
    expect(validateWorkflowFile('release.YAML', 1024 * 1024)).toBeUndefined();
  });

  it('rejects files without a YAML extension', () => {
    expect(validateWorkflowFile('workflow.json', 100)).toBe('extension');
  });

  it('rejects files larger than one megabyte', () => {
    expect(validateWorkflowFile('workflow.yaml', 1024 * 1024 + 1)).toBe('size');
  });
});
