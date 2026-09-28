import { describe, expect, it } from 'vitest';
import { layoutJobs, parseWorkflow, simulate } from '../src/engine.ts';
import { decodeWorkflow, encodeWorkflow } from '../src/share.ts';

const workflow = `name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  publish:
    needs: check
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
`;

describe('parseWorkflow', () => {
  it('reads workflow triggers, jobs, dependencies, steps and source lines', () => {
    const parsed = parseWorkflow(workflow);
    expect(parsed.name).toBe('CI');
    expect(parsed.events).toEqual(['push', 'pull_request']);
    expect(parsed.jobs.map(({ id }) => id)).toEqual(['check', 'publish']);
    expect(parsed.jobs[0]?.steps[0]?.name).toBe('npm test');
    expect(parsed.jobs[1]?.needs).toEqual(['check']);
    expect(parsed.jobs[1]?.line).toBe(11);
  });

  it('reports malformed yaml and missing dependency references with locations', () => {
    const syntax = parseWorkflow('on: [push\njobs: {}');
    expect(syntax.diagnostics.some((item) => item.code === 'yaml-syntax')).toBe(true);
    const missing = parseWorkflow(
      'on: push\njobs:\n  deploy:\n    needs: build\n    runs-on: ubuntu-latest\n',
    );
    expect(
      missing.diagnostics.find((item) => item.code === 'missing-needs'),
    ).toMatchObject({ line: 3, jobId: 'deploy' });
  });

  it('detects cycles and repeated dependencies', () => {
    const parsed = parseWorkflow(
      'on: push\njobs:\n  a:\n    needs: b\n  b:\n    needs: [a, a]\n',
    );
    expect(parsed.diagnostics.filter((item) => item.code === 'needs-cycle')).toHaveLength(
      2,
    );
    expect(parsed.diagnostics.some((item) => item.code === 'duplicate-needs')).toBe(true);
  });

  it('treats YAML syntax errors as diagnostics instead of throwing', () => {
    expect(() => parseWorkflow('jobs:\n  : [')).not.toThrow();
  });

  it('records trigger filters that need branch or path context', () => {
    const parsed = parseWorkflow(
      'on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n    inputs:\n      target:\n        required: true\njobs:\n  build:\n    runs-on: ubuntu-latest\n',
    );
    expect(parsed.eventFilters).toEqual(['push']);
    expect(simulate(parsed, 'push').get('build')).toBe('unknown');
    expect(simulate(parsed, 'workflow_dispatch').get('build')).toBe('runs');
  });
});

describe('simulate', () => {
  it('runs matching jobs, skips mismatched conditions and marks unknown expressions honestly', () => {
    const parsed = parseWorkflow(
      `on: [push, pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n  publish:\n    needs: build\n    if: github.event_name == 'push'\n  custom:\n    if: secrets.SHOULD_RUN == 'yes'\n`,
    );
    expect(simulate(parsed, 'push')).toMatchObject(
      new Map([
        ['build', 'runs'],
        ['publish', 'runs'],
        ['custom', 'unknown'],
      ]),
    );
    expect(simulate(parsed, 'pull_request').get('publish')).toBe('skipped');
    expect(simulate(parsed, 'schedule').get('build')).toBe('skipped');
  });

  it('does not guess at compound conditions that merely mention an event', () => {
    const parsed = parseWorkflow(
      `on: [push, pull_request]\njobs:\n  build:\n    if: github.event_name == 'push' || secrets.DEPLOY == 'yes'\n`,
    );
    expect(simulate(parsed, 'pull_request').get('build')).toBe('unknown');
  });
});

describe('layoutJobs', () => {
  it('places dependencies before their dependants and tolerates cycles', () => {
    const jobs = parseWorkflow(
      'on: push\njobs:\n  a:\n    runs-on: x\n  b:\n    needs: a\n  c:\n    needs: b\n',
    ).jobs;
    const layout = layoutJobs(jobs);
    expect(layout.get('a')!.column).toBeLessThan(layout.get('b')!.column);
    expect(layout.get('b')!.column).toBeLessThan(layout.get('c')!.column);
    expect(() =>
      layoutJobs(
        parseWorkflow('on: push\njobs:\n  a:\n    needs: b\n  b:\n    needs: a\n').jobs,
      ),
    ).not.toThrow();
  });
});

describe('workflow share links', () => {
  it('round-trips unicode and payloads larger than the spread argument limit', () => {
    const raw = `# release 🚀\n${'jobs:\n  build:\n'.repeat(12000)}`;
    expect(decodeWorkflow(encodeWorkflow(raw))).toBe(raw);
  });
});
