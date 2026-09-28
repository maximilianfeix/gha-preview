import { parseDocument, isMap, isSeq, isScalar, type Node, type Pair } from 'yaml';

export type DiagnosticLevel = 'error' | 'warning' | 'note';
export type Diagnostic = {
  level: DiagnosticLevel;
  code: string;
  message: string;
  line?: number;
  jobId?: string;
};
export type Step = { name: string; line: number; uses?: string; run?: string };
export type MatrixInfo = {
  axes: { name: string; values: string[] }[];
  combinations: Record<string, string>[];
  baseCount: number;
  truncated: boolean;
  dynamic: boolean;
  include: boolean;
  exclude: boolean;
};
export type Job = {
  id: string;
  name: string;
  line: number;
  needs: string[];
  steps: Step[];
  condition?: string;
  runsOn?: string;
  strategy?: MatrixInfo;
  permissions?: string;
};
export type JobChange = 'added' | 'removed' | 'changed' | 'unchanged';
export type Workflow = {
  name: string;
  events: string[];
  eventFilters: string[];
  jobs: Job[];
  diagnostics: Diagnostic[];
  raw: string;
};

export function diffJobs(base: Workflow, current: Workflow): Map<string, JobChange> {
  const baseJobs = new Map(base.jobs.map((job) => [job.id, job]));
  const currentJobs = new Map(current.jobs.map((job) => [job.id, job]));
  const ids = new Set([...baseJobs.keys(), ...currentJobs.keys()]);
  const changes = new Map<string, JobChange>();
  for (const id of ids) {
    const before = baseJobs.get(id);
    const after = currentJobs.get(id);
    if (!before) {
      changes.set(id, 'added');
      continue;
    }
    if (!after) {
      changes.set(id, 'removed');
      continue;
    }
    const snapshot = (job: Job) =>
      JSON.stringify({
        name: job.name,
        needs: [...job.needs].sort(),
        condition: job.condition,
        runsOn: job.runsOn,
        strategy: job.strategy
          ? {
              axes: [...job.strategy.axes]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((axis) => ({ name: axis.name, values: axis.values })),
              include: job.strategy.include,
              exclude: job.strategy.exclude,
            }
          : undefined,
        permissions: job.permissions,
        steps: job.steps.map(({ name, uses, run }) => ({ name, uses, run })),
      });
    changes.set(id, snapshot(before) === snapshot(after) ? 'unchanged' : 'changed');
  }
  return changes;
}

const asObject = (node: Node | null | undefined): Map<unknown, Node> | undefined =>
  isMap(node)
    ? new Map<unknown, Node>(
        node.items.map((pair: Pair) => [
          pair.key && isScalar(pair.key) ? pair.key.value : pair.key,
          pair.value as Node,
        ]),
      )
    : undefined;
const scalar = (node: Node | null | undefined): string | undefined =>
  isScalar(node) &&
  (typeof node.value === 'string' ||
    typeof node.value === 'number' ||
    typeof node.value === 'boolean')
    ? String(node.value)
    : undefined;
const nodeLine = (node: Node | null | undefined, source: string): number =>
  node?.range ? source.slice(0, node.range[0]).split('\n').length : 1;

function readEvents(node: Node | null | undefined): string[] {
  if (isSeq(node))
    return node.items
      .map((item) => scalar(item as Node))
      .filter((value): value is string => Boolean(value));
  if (isMap(node))
    return node.items
      .map((pair) => scalar(pair.key as Node))
      .filter((value): value is string => Boolean(value));
  const value = scalar(node);
  return value ? [value] : [];
}

function readMatrix(strategyNode: Node | null | undefined): MatrixInfo | undefined {
  const strategy = asObject(strategyNode);
  const matrixNode = strategy?.get('matrix');
  const matrix = asObject(matrixNode);
  if (!matrix) return undefined;
  const includeNode = matrix.get('include');

  const axes = [...matrix]
    .filter(([name, node]) => name !== 'include' && name !== 'exclude' && isSeq(node))
    .map(([name, node]) => ({
      name: String(name),
      values: (node as Node & { items: Node[] }).items
        .map((item) => scalar(item))
        .filter((value): value is string => value !== undefined),
    }))
    .filter((axis) => axis.values.length > 0);
  let combinations: Record<string, string>[] = axes.length ? [{}] : [];
  const baseCount = axes.reduce(
    (count, axis) => Math.min(count * axis.values.length, 129),
    axes.length ? 1 : 0,
  );
  const truncated = baseCount > 128;
  for (const axis of axes) {
    const next: Record<string, string>[] = [];
    for (const combination of combinations) {
      for (const value of axis.values) {
        next.push({ ...combination, [axis.name]: value });
        if (next.length >= 128) break;
      }
      if (next.length >= 128) break;
    }
    combinations = next.slice(0, 128);
  }

  const exclusions = isSeq(matrix.get('exclude'))
    ? (matrix.get('exclude') as Node & { items: Node[] }).items.flatMap((item) => {
        const object = asObject(item);
        if (!object) return [];
        const entries = [...object].flatMap(([key, value]) => {
          const itemValue = scalar(value);
          return itemValue === undefined ? [] : [[String(key), itemValue]];
        });
        if (!entries.length) return [];
        return [Object.fromEntries(entries)];
      })
    : [];
  combinations = combinations.filter(
    (combination) =>
      !exclusions.some((excluded) =>
        Object.entries(excluded).every(([key, value]) => combination[key] === value),
      ),
  );

  return {
    axes,
    combinations,
    baseCount,
    truncated,
    dynamic: axes.some((axis) => axis.values.some((value) => value.includes('${{'))),
    include: isSeq(includeNode) && includeNode.items.length > 0,
    exclude: exclusions.length > 0,
  };
}

export function parseWorkflow(raw: string): Workflow {
  const doc = parseDocument(raw, {
    uniqueKeys: true,
    prettyErrors: false,
    schema: 'core',
  });
  const diagnostics: Diagnostic[] = [];
  for (const error of doc.errors) {
    diagnostics.push({
      level: 'error',
      code: 'yaml-syntax',
      message: error.message,
      line: error.linePos?.[0]?.line,
    });
  }
  const root = asObject(doc.contents as Node | null);
  if (!root)
    return {
      name: 'Untitled workflow',
      events: [],
      eventFilters: [],
      jobs: [],
      diagnostics: diagnostics.length
        ? diagnostics
        : [
            {
              level: 'error',
              code: 'workflow-root',
              message: 'Expected a YAML object at the document root.',
            },
          ],
      raw,
    };
  const eventsNode = root.get('on');
  const events = readEvents(eventsNode as Node | undefined);
  const triggerConfig = asObject(eventsNode as Node | undefined);
  const filterKeys = new Set([
    'branches',
    'branches-ignore',
    'paths',
    'paths-ignore',
    'tags',
    'tags-ignore',
    'types',
  ]);
  const eventFilters = [...(triggerConfig ?? [])]
    .filter(
      ([event, config]) =>
        String(event) !== 'workflow_dispatch' &&
        [...(asObject(config) ?? [])].some(([key]) => filterKeys.has(String(key))),
    )
    .map(([event]) => String(event));
  const jobsNode = root.get('jobs') as Node | undefined;
  const jobsMap = asObject(jobsNode);
  if (!events.length)
    diagnostics.push({
      level: 'warning',
      code: 'missing-trigger',
      message: 'No workflow trigger was found under “on”.',
      line: eventsNode ? nodeLine(eventsNode as Node, raw) : 1,
    });
  if (!jobsMap?.size)
    diagnostics.push({
      level: 'error',
      code: 'missing-jobs',
      message: 'This workflow has no jobs to run.',
      line: 1,
    });
  const jobs: Job[] = [];
  const jobPairs = isMap(jobsNode) ? jobsNode.items : [];
  for (const pair of jobPairs) {
    const key = pair.key && isScalar(pair.key) ? pair.key.value : pair.key;
    const value = pair.value;
    const id = String(key);
    const map = asObject(value as Node);
    if (!map) {
      diagnostics.push({
        level: 'error',
        code: 'invalid-job',
        message: `Job “${id}” must be an object.`,
        line: nodeLine(pair.key as Node, raw),
        jobId: id,
      });
      continue;
    }
    const needsNode = map.get('needs') as Node | undefined;
    const needsRaw = isSeq(needsNode)
      ? needsNode.items.map((item) => scalar(item as Node))
      : scalar(needsNode)
        ? [scalar(needsNode)]
        : [];
    const needs = needsRaw.filter((item): item is string => Boolean(item));
    const stepNode = map.get('steps') as Node | undefined;
    const steps = isSeq(stepNode)
      ? stepNode.items.flatMap((step): Step[] => {
          const stepMap = asObject(step as Node);
          if (!stepMap) return [];
          return [
            {
              name:
                scalar(stepMap.get('name') as Node) ??
                scalar(stepMap.get('uses') as Node) ??
                scalar(stepMap.get('run') as Node)?.split('\n')[0] ??
                'Unnamed step',
              line: nodeLine(step as Node, raw),
              uses: scalar(stepMap.get('uses') as Node),
              run: scalar(stepMap.get('run') as Node),
            },
          ];
        })
      : [];
    jobs.push({
      id,
      name: scalar(map.get('name') as Node) ?? id,
      line: nodeLine(pair.key as Node, raw),
      needs,
      steps,
      condition: scalar(map.get('if') as Node),
      runsOn: scalar(map.get('runs-on') as Node),
      strategy: readMatrix(map.get('strategy') as Node),
      permissions: scalar(map.get('permissions') as Node),
    });
  }
  const known = new Set(jobs.map((job) => job.id));
  for (const job of jobs) {
    const seen = new Set<string>();
    for (const dependency of job.needs) {
      if (!known.has(dependency))
        diagnostics.push({
          level: 'error',
          code: 'missing-needs',
          message: `Job “${job.id}” depends on unknown job “${dependency}”.`,
          line: job.line,
          jobId: job.id,
        });
      if (seen.has(dependency))
        diagnostics.push({
          level: 'warning',
          code: 'duplicate-needs',
          message: `Job “${job.id}” lists “${dependency}” more than once.`,
          line: job.line,
          jobId: job.id,
        });
      seen.add(dependency);
    }
    if (!job.needs.length && !job.condition)
      diagnostics.push({
        level: 'note',
        code: 'entry-job',
        message: `“${job.id}” is an entry job and can start without another job finishing.`,
        line: job.line,
        jobId: job.id,
      });
    if (job.condition?.includes('always()'))
      diagnostics.push({
        level: 'note',
        code: 'always-condition',
        message: `“${job.id}” uses always(); it can run even when an earlier job fails.`,
        line: job.line,
        jobId: job.id,
      });
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleNodes = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (visiting.has(id)) {
      path.slice(path.indexOf(id)).forEach((part) => cycleNodes.add(part));
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const job = jobs.find((item) => item.id === id);
    for (const dependency of job?.needs ?? [])
      if (known.has(dependency)) visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  jobs.forEach((job) => visit(job.id, []));
  for (const id of cycleNodes) {
    const job = jobs.find((item) => item.id === id)!;
    diagnostics.push({
      level: 'error',
      code: 'needs-cycle',
      message: `Job “${id}” is part of a dependency cycle.`,
      line: job.line,
      jobId: id,
    });
  }
  const name = scalar(root.get('name') as Node) ?? 'Untitled workflow';
  return { name, events, eventFilters, jobs, diagnostics, raw };
}

export type ScenarioState = 'runs' | 'skipped' | 'unknown' | 'waiting';
export function simulate(workflow: Workflow, event: string): Map<string, ScenarioState> {
  const states = new Map<string, ScenarioState>();
  const triggerMatches =
    workflow.events.includes(event) || workflow.events.includes('**');
  for (const job of workflow.jobs) {
    if (!triggerMatches) {
      states.set(job.id, 'skipped');
      continue;
    }
    if (workflow.eventFilters.includes(event)) {
      states.set(job.id, 'unknown');
      continue;
    }
    const condition = job.condition
      ?.trim()
      .replace(/^\$\{\{|\}\}$/g, '')
      .trim();
    const equality = condition?.match(
      /^github\.event_name\s*(===|==|!==|!=)\s*(['\"])([^'\"]+)\2$/,
    );
    if (
      !condition ||
      condition === 'success()' ||
      condition === 'always()' ||
      condition === 'true'
    ) {
      states.set(job.id, 'runs');
      continue;
    }
    if (condition === 'false') {
      states.set(job.id, 'skipped');
      continue;
    }
    if (equality) {
      const matches = event === equality[3];
      states.set(
        job.id,
        equality[1]!.startsWith('!')
          ? matches
            ? 'skipped'
            : 'runs'
          : matches
            ? 'runs'
            : 'skipped',
      );
      continue;
    }
    states.set(job.id, 'unknown');
  }
  return states;
}

export function layoutJobs(jobs: Job[]): Map<string, { column: number; row: number }> {
  const depth = new Map<string, number>();
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const getDepth = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    const next = new Set(seen).add(id);
    const job = byId.get(id)!;
    const value = Math.max(
      0,
      ...job.needs
        .filter((dependency) => byId.has(dependency))
        .map((dependency) => getDepth(dependency, next) + 1),
    );
    depth.set(id, value);
    return value;
  };
  const cols = new Map<number, number>();
  return new Map(
    jobs.map((job) => {
      const column = getDepth(job.id);
      const row = cols.get(column) ?? 0;
      cols.set(column, row + 1);
      return [job.id, { column, row }];
    }),
  );
}
