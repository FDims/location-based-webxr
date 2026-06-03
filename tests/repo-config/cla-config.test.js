// Repo-meta test: verifies that the CLA workflow, CLA document, contributor
// guide, and PR template stay consistent.
//
// Why this test matters: the CLA flow combines four artifacts that have to
// agree on a single sign-off sentence and a single signature storage layout.
// If any one of them drifts (e.g. someone tweaks the wording in CONTRIBUTING.md
// without updating the workflow's `custom-pr-sign-comment`), real contributors
// would post a sentence the bot does not recognize, and signatures would never
// be recorded. We cannot detect that with a live PR test until the first
// external contribution arrives, so this static check is the only safety net
// we have until then. See §10.2 step 6 of
// docs/2026-03-30-separate-public-repo-plan.md (private repo).
//
// Coverage limits: this test does NOT verify the bot actually posts comments,
// the workflow's `pull_request_target` permissions are correct, the action can
// push to the `cla-signatures` branch with the default GITHUB_TOKEN, or that
// replying with the sign-off line records the signature. Those behaviors only
// exercise meaningfully against a real PR from a non-allowlisted account; we
// deliberately defer that validation to the first external contributor.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { parse as parseYaml } from 'yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readFile(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function findClaStep(workflow) {
  const job = workflow?.jobs?.cla;
  if (!job || !Array.isArray(job.steps)) {
    throw new Error('cla.yml is missing jobs.cla.steps array');
  }
  const step = job.steps.find(
    (s) => typeof s?.uses === 'string' && s.uses.startsWith('contributor-assistant/github-action'),
  );
  if (!step) {
    throw new Error('cla.yml has no step using contributor-assistant/github-action');
  }
  return step;
}

describe('CLA configuration consistency', () => {
  let workflow;
  let workflowText;
  let claStep;
  let withParams;
  let claMd;
  let contributing;
  let prTemplate;

  beforeAll(() => {
    workflowText = readFile('.github/workflows/cla.yml');
    workflow = parseYaml(workflowText);
    claStep = findClaStep(workflow);
    withParams = claStep.with ?? {};
    claMd = readFile('CLA.md');
    contributing = readFile('CONTRIBUTING.md');
    prTemplate = readFile('.github/PULL_REQUEST_TEMPLATE.md');
  });

  it('CLA.md exists at the repo root and is non-empty', () => {
    expect(existsSync(resolve(repoRoot, 'CLA.md'))).toBe(true);
    expect(claMd.trim().length).toBeGreaterThan(0);
  });

  it('cla.yml pins contributor-assistant/github-action to an immutable ref (not a moving tag)', () => {
    // Accept either a semver tag (@vX.Y.Z) or — preferably — a full 40-char
    // commit SHA pin, which GitHub's security-hardening guide recommends as the
    // most immutable form. A bare @main / @v2 moving tag is rejected by both.
    const semverPin = /^contributor-assistant\/github-action@v\d+\.\d+\.\d+$/;
    const shaPin = /^contributor-assistant\/github-action@[0-9a-f]{40}$/;
    expect(claStep.uses).toSatisfy(
      (uses) => semverPin.test(uses) || shaPin.test(uses),
    );

    // When pinned by SHA, require a human-readable version comment on the same
    // line so reviewers can tell which release the opaque SHA corresponds to.
    if (shaPin.test(claStep.uses)) {
      expect(workflowText).toMatch(
        /uses:\s*contributor-assistant\/github-action@[0-9a-f]{40}\s*#\s*v\d+\.\d+\.\d+/,
      );
    }
  });

  it('the workflow sign-off sentence is quoted verbatim somewhere in CONTRIBUTING.md', () => {
    const signComment = withParams['custom-pr-sign-comment'];
    expect(typeof signComment).toBe('string');
    expect(signComment.length).toBeGreaterThan(0);
    // Single source of truth check: if the workflow sentence drifts from
    // what the contributor guide tells people to type, signatures will silently
    // not be recorded.
    expect(contributing).toContain(signComment);
  });

  it('path-to-document points at a URL ending in /CLA.md', () => {
    const docUrl = withParams['path-to-document'];
    expect(typeof docUrl).toBe('string');
    let parsed;
    expect(() => {
      parsed = new URL(docUrl);
    }).not.toThrow();
    expect(parsed.pathname.endsWith('/CLA.md')).toBe(true);
  });

  it('signatures live at signatures/version1/cla.json on the cla-signatures branch', () => {
    expect(withParams['path-to-signatures']).toBe('signatures/version1/cla.json');
    expect(withParams['branch']).toBe('cla-signatures');
  });

  it('the PR template references CLA.md so contributors see the acknowledgement checkbox', () => {
    expect(prTemplate).toContain('CLA.md');
  });
});
