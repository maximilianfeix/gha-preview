import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeWorkflow, encodeWorkflow, maxWorkflowBytes } from '../src/share.ts';

describe('workflow share links', () => {
  it('round-trips Unicode and payloads larger than the spread argument limit', () => {
    const raw = `# release 🚀\n${'jobs:\n  build:\n'.repeat(12_000)}`;
    expect(decodeWorkflow(encodeWorkflow(raw))).toBe(raw);
  });

  it('rejects oversized input before compressing it', () => {
    expect(() => encodeWorkflow('x'.repeat(maxWorkflowBytes + 1))).toThrow(
      'smaller than 1 MB',
    );
  });

  it('stops an oversized decompression while the stream is being read', () => {
    const bomb = gzipSync(new Uint8Array(maxWorkflowBytes + 1));
    const encoded = Buffer.from(bomb).toString('base64url');
    expect(() => decodeWorkflow(encoded)).toThrow('larger than the 1 MB share limit');
  });

  it('rejects invalid and oversized share links', () => {
    expect(() => decodeWorkflow('!')).toThrow();
    expect(() => decodeWorkflow('x'.repeat(1_500_001))).toThrow('link is too large');
  });
});
