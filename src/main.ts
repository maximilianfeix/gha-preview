import { decodeWorkflow, encodeWorkflow } from './share.ts';
import {
  layoutJobs,
  parseWorkflow,
  simulate,
  type ScenarioState,
  type Workflow,
} from './engine.ts';
import './style.css';
import { validateWorkflowFile } from './file.ts';

const sample = `name: Release gate
on: [pull_request, push]
jobs:
  lint:
    name: Lint & typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run lint
  test:
    name: Test suite
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
  build:
    name: Build package
    needs: [lint, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run build
  publish:
    name: Publish release
    needs: build
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - run: npm publish`;

const icon = (name: string) => {
  const paths: Record<string, string> = {
    github:
      '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 6v-3.9a3.4 3.4 0 0 0-.9-2.7c3-.3 6.1-1.5 6.1-6.7a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.2-.4-3.8 1.4a13 13 0 0 0-6.9 0C5.4 1.1 4.2 1.5 4.2 1.5a4.8 4.8 0 0 0-.1 3.6 5.2 5.2 0 0 0-1.4 3.6c0 5.2 3.1 6.4 6.1 6.7A3.4 3.4 0 0 0 8 18v3"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    share:
      '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.4m-6.6 7 6.6 4.4"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m12-7-5-5-5 5m5-5v12"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6m6-16-4 20"/>',
    arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ''}</svg>`;
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const stateLabel: Record<ScenarioState, string> = {
  runs: 'Eligible',
  skipped: 'Skipped',
  unknown: 'Needs context',
  waiting: 'Waiting',
};
const stateSymbol: Record<ScenarioState, string> = {
  runs: '✓',
  skipped: '—',
  unknown: '?',
  waiting: '…',
};
const root = document.querySelector<HTMLDivElement>('#app')!;

root.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#top" aria-label="gha-preview home"><span class="brand-mark"><i></i><i></i><i></i></span><span>gha<span class="brand-dot">.</span>preview</span></a>
    <nav class="topnav" aria-label="Main navigation"><a href="#how">How it works</a><a href="https://github.com/maximilianfeix/gha-preview" target="_blank" rel="noreferrer">GitHub ${icon('arrow')}</a><a class="topnav-star" href="https://github.com/maximilianfeix/gha-preview" target="_blank" rel="noreferrer">${icon('github')} Star project</a></nav>
  </header>
  <main id="top">
    <section class="hero">
      <div class="hero-copy"><div class="eyebrow"><span class="live-dot"></span> YOUR WORKFLOW, BEFORE IT RUNS</div><h1>See the run<br/>before the <em>run.</em></h1><p class="hero-lede">GitHub Actions makes sense when you can see it. Preview jobs, dependencies and conditions in a workflow you can actually explore.</p><div class="hero-trust"><span>${icon('check')} Runs in your browser</span><span>${icon('check')} Your YAML stays yours</span></div></div>
      <div class="hero-art" aria-label="Illustration of a workflow graph"><svg viewBox="0 0 560 330" role="img" aria-label="Jobs connected in a release pipeline"><defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#d5dad2"/></pattern><marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 10 5 0 10z" fill="#acb5ab"/></marker></defs><rect width="560" height="330" fill="url(#grid)" opacity=".7"/><path class="art-line" d="M170 93h72v62h60M170 237h72v-82h60m98 0h50v-72h43m-93 72h50v82h43"/><g class="art-node art-node-a"><rect x="46" y="61" width="124" height="64" rx="12"/><circle cx="64" cy="82" r="5"/><text x="78" y="86">lint</text><text class="art-sub" x="64" y="106">ubuntu-latest</text></g><g class="art-node"><rect x="46" y="205" width="124" height="64" rx="12"/><circle class="green-dot" cx="64" cy="226" r="5"/><text x="78" y="230">test</text><text class="art-sub" x="64" y="250">ubuntu-latest</text></g><g class="art-node art-node-build"><rect x="302" y="123" width="98" height="64" rx="12"/><circle class="green-dot" cx="320" cy="144" r="5"/><text x="334" y="148">build</text><text class="art-sub" x="320" y="168">2 dependencies</text></g><g class="art-node art-node-release"><rect x="442" y="61" width="100" height="64" rx="12"/><circle class="amber-dot" cx="460" cy="82" r="5"/><text x="474" y="86">release</text><text class="art-sub" x="460" y="106">push only</text></g><g class="art-node art-node-package"><rect x="442" y="205" width="100" height="64" rx="12"/><circle cx="460" cy="226" r="5"/><text x="474" y="230">preview</text><text class="art-sub" x="460" y="250">pull request</text></g><circle class="orbit orbit-one" cx="351" cy="31" r="6"/><circle class="orbit orbit-two" cx="427" cy="287" r="4"/></svg><div class="art-caption">ONE RELEASE FLOW · FIVE JOBS · ZERO GUESSWORK</div></div>
      <a class="scroll-cue" href="#playground">SCROLL TO TRY <span></span></a>
    </section>
    <section id="playground" class="workspace-section">
      <div class="section-heading"><div><span class="section-kicker">THE PLAYGROUND</span><h2>Make the workflow make sense.</h2></div><p>Drop in a workflow file, then click any job to find its place in the YAML.</p></div>
      <div class="workbench">
        <div class="workbench-bar"><div class="bar-file"><span class="file-icon">Y</span><span id="filename">release.yml</span><span class="bar-path">.github / workflows</span></div><div class="bar-actions"><label class="file-button" for="file-input">${icon('upload')}<span>Open file</span></label><input id="file-input" type="file" accept=".yml,.yaml,text/yaml" hidden/><button id="share-button" class="icon-button" title="Copy a link to this workflow">${icon('share')}<span class="mobile-hide"> Share</span></button><button id="export-button" class="icon-button" title="Download the job graph as SVG">${icon('download')}<span class="mobile-hide"> SVG</span></button></div></div>
        <div class="workbench-body"><section class="editor-pane" aria-label="Workflow editor"><div class="pane-heading"><div><span class="pane-dot"></span> workflow.yml</div><span class="pane-hint">EDIT TO PREVIEW</span></div><div class="editor-wrap"><div id="line-numbers" class="line-numbers" aria-hidden="true"></div><textarea id="yaml-input" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="GitHub Actions workflow YAML" wrap="off"></textarea></div><div id="editor-message" class="editor-message"><span class="privacy-icon">●</span> Parsed locally. Nothing is uploaded.</div></section>
          <section class="graph-pane" aria-label="Interactive workflow graph"><div class="pane-heading graph-heading"><div><span class="graph-heading-mark">${icon('code')}</span> Job map <span id="job-count" class="count-pill">—</span></div><div class="graph-controls" aria-label="Graph view controls"><button id="zoom-out" class="zoom-button" aria-label="Zoom out" title="Zoom out">−</button><output id="zoom-level" class="zoom-level" aria-live="polite">100%</output><button id="zoom-in" class="zoom-button" aria-label="Zoom in" title="Zoom in">+</button><button id="fit-button" class="quiet-button" title="Reset zoom and center the graph">Reset</button></div></div><div id="graph-scroll" class="graph-scroll"><div id="graph" class="graph-canvas"></div></div><div class="graph-footer"><span><i class="legend-dot success"></i>Eligible</span><span><i class="legend-dot conditional"></i>Conditional</span><span><i class="legend-dot unknown"></i>Unknown</span><span class="graph-hint">Scroll to pan · Ctrl + wheel to zoom</span></div></section>
        </div>
        <div class="scenario-bar"><div class="scenario-intro">${icon('play')}<span><strong>Try a scenario</strong><small>See what this event would start</small></span></div><div id="event-picker" class="event-picker"></div><span class="scenario-caveat">Event filters need context</span><button id="reset-scenario" class="reset-button">Reset</button></div>
        <div id="inspector" class="inspector" hidden></div>
        <div id="diagnostics" class="diagnostics"></div>
      </div>
      <p class="under-workbench">The preview is static analysis, not a GitHub runner. Expressions needing runtime data stay marked <strong>Needs context</strong>.</p>
    </section>
    <section id="how" class="how-section"><div class="how-intro"><span class="section-kicker">A CLEARER VIEW OF CI</span><h2>Less YAML archaeology.<br/>More confidence to push.</h2><p>One file in. A workflow you can reason about.</p></div><div class="feature-list"><article class="feature-row"><span class="feature-index">A</span><div><h3>Follow every dependency</h3><p>See how <code>needs:</code> connects jobs and where a workflow can branch, wait or stop.</p></div><span class="feature-visual graph-mini"><i></i><i></i><i></i><b></b><b></b></span></article><article class="feature-row"><span class="feature-index">B</span><div><h3>Understand the conditions</h3><p>Preview familiar events. Anything that depends on secrets or runtime results stays honestly unresolved.</p></div><span class="feature-visual condition-mini"><span>if:</span><b>push</b><i>?</i></span></article><article class="feature-row"><span class="feature-index">C</span><div><h3>Jump to the exact line</h3><p>Every job in the map leads back to its YAML. Find the clause behind the shape.</p></div><span class="feature-visual line-mini"><span>18</span><i></i><i></i><b></b></span></article></div></section>
    <section class="closing"><div class="closing-mark"><span></span><span></span><span></span><b></b></div><div><span class="section-kicker">BEFORE THE NEXT PUSH</span><h2>Give your workflow<br/>a second look.</h2></div><a href="#playground" class="closing-link">Try the live preview ${icon('arrow')}</a></section>
  </main>
  <footer class="site-footer"><a class="brand footer-brand" href="#top"><span class="brand-mark"><i></i><i></i><i></i></span><span>gha<span class="brand-dot">.</span>preview</span></a><span>Made for the moments between editing and pushing.</span><a href="https://github.com/maximilianfeix/gha-preview" target="_blank" rel="noreferrer">Open source on GitHub ${icon('arrow')}</a></footer>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>`;

const input = root.querySelector<HTMLTextAreaElement>('#yaml-input')!;
const lineNumbers = root.querySelector<HTMLDivElement>('#line-numbers')!;
const graph = root.querySelector<HTMLDivElement>('#graph')!;
const diagnostics = root.querySelector<HTMLDivElement>('#diagnostics')!;
const eventPicker = root.querySelector<HTMLDivElement>('#event-picker')!;
const inspector = root.querySelector<HTMLDivElement>('#inspector')!;
const toast = root.querySelector<HTMLDivElement>('#toast')!;
const graphViewport = root.querySelector<HTMLDivElement>('#graph-scroll')!;
let graphZoom = 1;
let parsed: Workflow;
let selectedJob: string | undefined;
let selectedEvent = '';
let activeFile = 'release.yml';
let toastTimer = 0;
const editorPane = root.querySelector<HTMLElement>('.editor-pane')!;
let dragDepth = 0;

async function loadWorkflowFile(file: File) {
  const error = validateWorkflowFile(file.name, file.size);
  if (error === 'extension') {
    notify('Choose a .yml or .yaml workflow file.');
    return;
  }
  if (error === 'size') {
    notify('Choose a workflow smaller than 1 MB.');
    return;
  }
  try {
    input.value = await file.text();
    activeFile = file.name;
    root.querySelector('#filename')!.textContent = activeFile;
    selectedJob = undefined;
    update();
  } catch {
    notify('Could not read that workflow file.');
  }
}

editorPane.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  dragDepth += 1;
  editorPane.classList.add('is-drop-target');
});
editorPane.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});
editorPane.addEventListener('dragleave', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) editorPane.classList.remove('is-drop-target');
});
editorPane.addEventListener('drop', (event) => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  dragDepth = 0;
  editorPane.classList.remove('is-drop-target');
  void loadWorkflowFile(event.dataTransfer.files[0]!);
});

function statusFor(id: string): ScenarioState {
  if (!selectedEvent || !parsed) return 'runs';
  return simulate(parsed, selectedEvent).get(id) ?? 'unknown';
}

function svgGraph(workflow: Workflow): string {
  if (!workflow.jobs.length)
    return `<div class="empty-graph"><span>${icon('code')}</span><strong>Waiting for jobs</strong><p>Add a <code>jobs:</code> block to see the map.</p></div>`;
  const points = layoutJobs(workflow.jobs);
  const maxColumn = Math.max(...[...points.values()].map((point) => point.column));
  const colWidth = 224;
  const rowHeight = 132;
  const padding = 42;
  const width = Math.max(520, padding * 2 + maxColumn * colWidth + 190);
  const maxRows = Math.max(...[...points.values()].map((point) => point.row)) + 1;
  const height = Math.max(300, padding * 2 + maxRows * rowHeight);
  const coords = new Map(
    [...points].map(([id, point]) => [
      id,
      {
        x: padding + point.column * colWidth,
        y: padding + point.row * rowHeight,
      },
    ]),
  );
  const lines = workflow.jobs
    .flatMap((job) =>
      job.needs.flatMap((dependency) => {
        const from = coords.get(dependency);
        const to = coords.get(job.id);
        if (!from || !to) return [];
        const state = statusFor(job.id);
        const x1 = from.x + 176;
        const y1 = from.y + 48;
        const x2 = to.x;
        const y2 = to.y + 48;
        const mid = (x1 + x2) / 2;
        return [
          `<path class="edge ${state === 'skipped' ? 'edge-muted' : ''}" d="M${x1} ${y1} C${mid} ${y1},${mid} ${y2},${x2 - 8} ${y2}" marker-end="url(#edge-arrow)"/>`,
        ];
      }),
    )
    .join('');
  const nodes = workflow.jobs
    .map((job) => {
      const position = coords.get(job.id)!;
      const status = statusFor(job.id);
      const conditional = Boolean(job.condition);
      const matrixLabel = job.strategy
        ? job.strategy.axes.length
          ? ` · matrix ×${job.strategy.truncated ? '128+' : job.strategy.combinations.length}`
          : ' · matrix · include only'
        : '';
      const label = job.name.length > 22 ? `${job.name.slice(0, 20)}…` : job.name;
      return `<g class="job-node state-${status} ${conditional ? 'has-condition' : ''} ${selectedJob === job.id ? 'is-selected' : ''}" transform="translate(${position.x} ${position.y})" data-job="${escapeHtml(job.id)}" tabindex="0" role="button" aria-label="${escapeHtml(job.name)}, ${stateLabel[status]}${matrixLabel}, line ${job.line}"><rect class="node-shell" x="0" y="0" width="176" height="96" rx="12"/><rect class="node-top-line" x="1" y="1" width="174" height="3" rx="2"/><circle class="node-state" cx="19" cy="23" r="5"/><text class="node-label" x="34" y="27">${escapeHtml(label)}</text><text class="node-id" x="16" y="52">${escapeHtml(job.id)}${matrixLabel}</text><line class="node-divider" x1="16" y1="64" x2="160" y2="64"/><text class="node-meta" x="16" y="82">${job.needs.length ? `${job.needs.length} ${job.needs.length === 1 ? 'dependency' : 'dependencies'}` : 'entry point'}</text><text class="node-status" x="160" y="82" text-anchor="end">${stateSymbol[status]} ${stateLabel[status]}</text><title>${escapeHtml(job.name)} · line ${job.line}${job.condition ? ` · if: ${escapeHtml(job.condition)}` : ''}${matrixLabel}</title></g>`;
    })
    .join('');
  return `<svg class="workflow-svg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="Workflow job dependency graph"><defs><marker id="edge-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#aeb8ae"/></marker></defs>${lines}${nodes}</svg>`;
}

function renderInspector(jobId: string) {
  const job = parsed.jobs.find((item) => item.id === jobId);
  if (!job) {
    inspector.hidden = true;
    return;
  }
  inspector.hidden = false;
  const matrix = job.strategy;
  const matrixCount = matrix
    ? matrix.axes.length
      ? `${matrix.truncated ? '128+' : matrix.combinations.length} combinations`
      : matrix.include
        ? 'include-only matrix'
        : 'matrix values need context'
    : '';
  const matrixPanel = matrix
    ? `<div class="inspector-matrix"><div class="matrix-title"><span>MATRIX PREVIEW</span><strong>${matrixCount}</strong></div><div class="matrix-axes">${matrix.axes.map((axis) => `<span><code>${escapeHtml(axis.name)}</code><span>${axis.values.map(escapeHtml).join(' · ')}</span></span>`).join('') || '<span>Combination values come from include entries.</span>'}</div><div class="matrix-variants">${matrix.combinations
        .slice(0, 12)
        .map(
          (combination) =>
            `<span>${matrix.axes.map((axis) => `<code>${escapeHtml(axis.name)}=${escapeHtml(combination[axis.name] ?? '')}</code>`).join(' ')}</span>`,
        )
        .join(
          '',
        )}${matrix.combinations.length > 12 ? `<small>and ${matrix.combinations.length - 12} more</small>` : ''}</div><p>${matrix.dynamic ? 'Expressions stay unresolved; values shown literally. ' : ''}${matrix.exclude ? 'Exclude entries are applied to the base preview. ' : ''}${matrix.include ? 'Include entries can add or modify variants and are not expanded here. ' : ''}${matrix.truncated ? 'The preview is capped at 128 candidates.' : 'This previews matrix values; it does not schedule runner jobs.'}</p></div>`
    : '';
  inspector.innerHTML = `<div class="inspector-main"><span class="inspector-glyph">${icon('code')}</span><div><span class="inspector-label">JOB DETAILS <button class="inline-source" data-line="${job.line}">line ${job.line}</button></span><h3>${escapeHtml(job.name)}</h3><code>${escapeHtml(job.id)}</code></div></div><div class="inspector-facts"><div><span>DEPENDS ON</span><p>${job.needs.length ? job.needs.map(escapeHtml).join(', ') : 'Nothing — starts first'}</p></div><div><span>CONDITION</span><p>${job.condition ? `<code>${escapeHtml(job.condition)}</code>` : 'Runs when its dependencies pass'}</p></div><div><span>RUNS ON</span><p>${escapeHtml(job.runsOn ?? 'Not specified')}</p></div></div>${matrixPanel}<div class="inspector-steps"><span>STEPS <b>${job.steps.length}</b></span>${
    job.steps
      .slice(0, 4)
      .map(
        (step) =>
          `<button class="step-row" data-line="${step.line}"><span class="step-number">${step.line}</span><span>${escapeHtml(step.name)}</span><span>${step.uses ? 'action' : 'command'}</span></button>`,
      )
      .join('') || '<p class="no-steps">No steps defined yet.</p>'
  }${job.steps.length > 4 ? `<p class="more-steps">and ${job.steps.length - 4} more steps in the source</p>` : ''}</div><button class="inspector-close" aria-label="Close job details">×</button>`;
  inspector.querySelector('.inspector-close')?.addEventListener('click', () => {
    selectedJob = undefined;
    inspector.hidden = true;
    renderGraph();
  });
  inspector
    .querySelectorAll<HTMLButtonElement>('[data-line]')
    .forEach((button) =>
      button.addEventListener('click', () => jumpToLine(Number(button.dataset.line))),
    );
}

function renderGraph() {
  const previousScrollLeft = graphViewport.scrollLeft;
  const previousScrollTop = graphViewport.scrollTop;
  graph.innerHTML = svgGraph(parsed);
  applyGraphZoom();
  graphViewport.scrollLeft = previousScrollLeft;
  graphViewport.scrollTop = previousScrollTop;
  graph.querySelectorAll<SVGGElement>('.job-node').forEach((node) => {
    const open = () => {
      selectedJob = node.dataset.job;
      renderGraph();
      renderInspector(selectedJob!);
    };
    node.addEventListener('click', open);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
  root.querySelector('#job-count')!.textContent = String(parsed.jobs.length);
}

function applyGraphZoom() {
  const svg = graph.querySelector<SVGSVGElement>('.workflow-svg');
  const output = root.querySelector<HTMLOutputElement>('#zoom-level')!;
  output.value = `${Math.round(graphZoom * 100)}%`;
  output.textContent = output.value;
  if (!svg) return;
  const width = Number(svg.getAttribute('width'));
  const height = Number(svg.getAttribute('height'));
  svg.style.width = `${width * graphZoom}px`;
  svg.style.height = `${height * graphZoom}px`;
}

function setGraphZoom(next: number) {
  const previous = graphZoom;
  graphZoom = Math.max(0.5, Math.min(2, Math.round(next * 10) / 10));
  if (graphZoom === previous) return;
  const focusX = (graphViewport.scrollLeft + graphViewport.clientWidth / 2) / previous;
  const focusY = (graphViewport.scrollTop + graphViewport.clientHeight / 2) / previous;
  applyGraphZoom();
  graphViewport.scrollLeft = focusX * graphZoom - graphViewport.clientWidth / 2;
  graphViewport.scrollTop = focusY * graphZoom - graphViewport.clientHeight / 2;
}

function renderEvents() {
  if (!parsed.events.length) {
    eventPicker.innerHTML = '<span class="no-events">No trigger found</span>';
    return;
  }
  if (!parsed.events.includes(selectedEvent)) selectedEvent = parsed.events[0]!;
  eventPicker.innerHTML = parsed.events
    .map(
      (event) =>
        `<button class="event-chip ${selectedEvent === event ? 'is-active' : ''}" data-event="${escapeHtml(event)}">${escapeHtml(event)}</button>`,
    )
    .join('');
  eventPicker.querySelectorAll<HTMLButtonElement>('.event-chip').forEach((button) =>
    button.addEventListener('click', () => {
      selectedEvent = button.dataset.event!;
      renderEvents();
      renderGraph();
    }),
  );
}

function renderDiagnostics() {
  const items = parsed.diagnostics;
  const errors = items.filter((item) => item.level === 'error').length;
  const warnings = items.filter((item) => item.level === 'warning').length;
  if (!items.length) {
    diagnostics.innerHTML =
      '<div class="diagnostics-clear"><span class="clear-check">✓</span><span><strong>Looks structurally sound</strong><small>No dependency issues found in this workflow.</small></span></div>';
    return;
  }
  diagnostics.innerHTML = `<div class="diagnostics-head"><strong>Workflow notes</strong><span>${errors ? `${errors} issue${errors === 1 ? '' : 's'}` : ''}${errors && warnings ? ' · ' : ''}${warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : ''}</span></div><div class="diagnostic-list">${items
    .slice(0, 5)
    .map(
      (item) =>
        `<button class="diagnostic diagnostic-${item.level}" data-line="${item.line ?? 1}"><span class="diagnostic-mark">${item.level === 'error' ? '!' : item.level === 'warning' ? '△' : 'i'}</span><span>${escapeHtml(item.message)}</span><span class="diagnostic-line">L${item.line ?? '—'}</span></button>`,
    )
    .join(
      '',
    )}${items.length > 5 ? `<div class="more-diagnostics">and ${items.length - 5} more</div>` : ''}</div>`;
  diagnostics
    .querySelectorAll<HTMLButtonElement>('.diagnostic')
    .forEach((button) =>
      button.addEventListener('click', () => jumpToLine(Number(button.dataset.line))),
    );
}

function update() {
  parsed = parseWorkflow(input.value);
  const lines = input.value.split('\n').length;
  lineNumbers.innerHTML = Array.from(
    { length: lines },
    (_, index) => `<span>${index + 1}</span>`,
  ).join('');
  root.querySelector<HTMLDivElement>('#editor-message')!.innerHTML =
    parsed.diagnostics.some((item) => item.level === 'error')
      ? `<span class="privacy-icon error-dot">●</span> ${escapeHtml(parsed.diagnostics.find((item) => item.level === 'error')!.message)}`
      : '<span class="privacy-icon">●</span> Parsed locally. Nothing is uploaded.';
  renderEvents();
  renderGraph();
  renderDiagnostics();
  if (selectedJob && parsed.jobs.some((job) => job.id === selectedJob))
    renderInspector(selectedJob);
}

function jumpToLine(line: number) {
  const starts = input.value.split('\n');
  const offset = starts
    .slice(0, Math.max(0, line - 1))
    .reduce((sum, item) => sum + item.length + 1, 0);
  input.focus();
  input.setSelectionRange(offset, offset + (starts[line - 1]?.length ?? 0));
  input.scrollTop = (line - 1) * 21;
  lineNumbers.scrollTop = input.scrollTop;
}
function notify(message: string) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
}

const exportedSvgStyle = `
  .edge{fill:none;stroke:#aeb9ad;stroke-width:1.5}.edge-muted{stroke-dasharray:4 4;opacity:.45}
  .node-shell{fill:#fff;stroke:#dce3db;stroke-width:1.2}.node-top-line{fill:#7cab7d}
  .has-condition .node-top-line{fill:#d5a754}.state-skipped .node-top-line{fill:#bbc2bc}
  .state-unknown .node-top-line{fill:#91a2b9}.node-state{fill:#398753}
  .state-skipped .node-state{fill:#a7b0a8}.state-unknown .node-state{fill:#879ab1}
  .node-label{fill:#2d3930;font:600 11px Arial,sans-serif}.node-id{fill:#768178;font:9px monospace}
  .node-divider{stroke:#e9ede8}.node-meta{fill:#89938a;font:8px monospace}
  .node-status{fill:#36784d;font:8px monospace}.state-skipped .node-status{fill:#89928a}
  .state-unknown .node-status{fill:#7588a1}
`;
input.value = sample;
input.addEventListener('input', update);
input.addEventListener('scroll', () => {
  lineNumbers.scrollTop = input.scrollTop;
});
root.querySelector('#reset-scenario')!.addEventListener('click', () => {
  selectedEvent = '';
  update();
});
root
  .querySelector('#zoom-in')!
  .addEventListener('click', () => setGraphZoom(graphZoom + 0.1));
root
  .querySelector('#zoom-out')!
  .addEventListener('click', () => setGraphZoom(graphZoom - 0.1));
root.querySelector('#fit-button')!.addEventListener('click', () => {
  graphZoom = 1;
  applyGraphZoom();
  graphViewport.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
});
graphViewport.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setGraphZoom(graphZoom + (event.deltaY < 0 ? 0.1 : -0.1));
  },
  { passive: false },
);
let panStart: { x: number; y: number; left: number; top: number } | undefined;
graphViewport.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse' || event.button !== 0) return;
  if (event.target instanceof Element && event.target.closest('.job-node')) return;
  panStart = {
    x: event.clientX,
    y: event.clientY,
    left: graphViewport.scrollLeft,
    top: graphViewport.scrollTop,
  };
  graphViewport.setPointerCapture(event.pointerId);
  graphViewport.classList.add('is-panning');
});
graphViewport.addEventListener('pointermove', (event) => {
  if (!panStart) return;
  graphViewport.scrollLeft = panStart.left - (event.clientX - panStart.x);
  graphViewport.scrollTop = panStart.top - (event.clientY - panStart.y);
});
function endPan(event: PointerEvent) {
  if (!panStart) return;
  panStart = undefined;
  graphViewport.classList.remove('is-panning');
  if (graphViewport.hasPointerCapture(event.pointerId)) {
    graphViewport.releasePointerCapture(event.pointerId);
  }
}
graphViewport.addEventListener('pointerup', endPan);
graphViewport.addEventListener('pointercancel', endPan);
root
  .querySelector<HTMLInputElement>('#file-input')!
  .addEventListener('change', async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    await loadWorkflowFile(file);
    (event.target as HTMLInputElement).value = '';
  });
root.querySelector('#share-button')!.addEventListener('click', async () => {
  let encoded: string;
  try {
    encoded = encodeWorkflow(input.value);
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Could not create a workflow link.');
    return;
  }
  const url = new URL(location.href);
  url.hash = `workflow=${encoded}`;
  try {
    await navigator.clipboard.writeText(url.toString());
    notify('Link copied — it contains your workflow YAML.');
  } catch {
    history.replaceState(null, '', url);
    notify('Link added to the address bar.');
  }
});
root.querySelector('#export-button')!.addEventListener('click', () => {
  const svg = graph.querySelector('svg');
  if (!svg) {
    notify('Add jobs before exporting the graph.');
    return;
  }
  const exportSvg = svg.cloneNode(true) as SVGSVGElement;
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = exportedSvgStyle;
  exportSvg.insertBefore(style, exportSvg.firstChild);
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('width', '100%');
  background.setAttribute('height', '100%');
  background.setAttribute('fill', '#f8faf7');
  exportSvg.insertBefore(background, style.nextSibling);
  const blob = new Blob([new XMLSerializer().serializeToString(exportSvg)], {
    type: 'image/svg+xml;charset=utf-8',
  });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${activeFile.replace(/\.ya?ml$/i, '') || 'workflow'}-map.svg`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  notify('Job map downloaded as SVG.');
});
const hashMatch = location.hash.match(/workflow=([^&]+)/);
if (hashMatch) {
  try {
    input.value = decodeWorkflow(hashMatch[1]!);
    activeFile = 'shared-workflow.yml';
    root.querySelector('#filename')!.textContent = activeFile;
  } catch {
    notify('This workflow link is invalid. Showing the example instead.');
  }
}
update();
