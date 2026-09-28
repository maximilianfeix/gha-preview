import { compressSync, Gunzip, strFromU8, strToU8 } from 'fflate';

export const maxWorkflowBytes = 1024 * 1024;
const maxShareCharacters = 1_500_000;

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function encodeWorkflow(raw: string): string {
  const bytes = strToU8(raw);
  if (bytes.byteLength > maxWorkflowBytes) {
    throw new Error('Workflow must be smaller than 1 MB to share.');
  }
  return base64Url(compressSync(bytes));
}

export function decodeWorkflow(encoded: string): string {
  if (encoded.length > maxShareCharacters) {
    throw new Error('This workflow link is too large.');
  }
  const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const chunks: Uint8Array[] = [];
  let size = 0;
  const gunzip = new Gunzip();
  gunzip.ondata = (chunk) => {
    size += chunk.byteLength;
    if (size > maxWorkflowBytes) {
      throw new Error('This workflow is larger than the 1 MB share limit.');
    }
    chunks.push(chunk);
  };
  gunzip.push(bytes, true);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return strFromU8(output);
}
