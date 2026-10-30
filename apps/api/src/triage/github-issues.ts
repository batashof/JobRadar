import { FIX_LABEL } from './triage-logic';

/**
 * The few GitHub REST calls the daily triage makes (ADR-036), on the
 * workflow's own GITHUB_TOKEN with `issues: write`. Plain fetch, no Octokit:
 * three endpoints do not earn a dependency (ADR-001).
 */

const API = 'https://api.github.com';

export interface GithubRepo {
  /** `owner/name`, as `GITHUB_REPOSITORY` gives it. */
  repo: string;
  token: string;
}

export type IssueOutcome = 'open' | 'done' | 'skip';

function headers(gh: GithubRepo): Record<string, string> {
  return {
    authorization: `Bearer ${gh.token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  };
}

async function fail(response: Response, what: string): Promise<never> {
  const text = await response.text().catch(() => '');
  throw new Error(`${what}: HTTP ${response.status} ${text.slice(0, 200)}`);
}

/** Creates the fixer's label once; 422 means it is already there. */
export async function ensureFixLabel(gh: GithubRepo): Promise<void> {
  const response = await fetch(`${API}/repos/${gh.repo}/labels`, {
    method: 'POST',
    headers: headers(gh),
    body: JSON.stringify({
      name: FIX_LABEL,
      color: 'd93f0b',
      description: 'Marked in the bot triage for the automatic fixer (ADR-036)',
    }),
  });
  if (!response.ok && response.status !== 422) await fail(response, 'create label');
}

export async function createIssue(
  gh: GithubRepo,
  issue: { title: string; body: string; labels: string[] },
): Promise<number> {
  const response = await fetch(`${API}/repos/${gh.repo}/issues`, {
    method: 'POST',
    headers: headers(gh),
    body: JSON.stringify(issue),
  });
  if (!response.ok) await fail(response, 'create issue');
  const created = (await response.json()) as { number: number };
  return created.number;
}

/**
 * Where an issue stands for the inbox: closed as completed is done, closed
 * as not planned is skipped, anything else is still with the fixer.
 */
export async function issueOutcome(gh: GithubRepo, number: number): Promise<IssueOutcome> {
  const response = await fetch(`${API}/repos/${gh.repo}/issues/${number}`, { headers: headers(gh) });
  if (!response.ok) await fail(response, `read issue #${number}`);
  const issue = (await response.json()) as { state: string; state_reason?: string | null };
  if (issue.state !== 'closed') return 'open';
  return issue.state_reason === 'not_planned' ? 'skip' : 'done';
}
