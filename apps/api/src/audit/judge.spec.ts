import { buildJudgeMessages, callJudge, judgeProviders, parseVerdicts, retryDelayMs } from './judge';
import { FRONTEND, vacancy } from './fixtures';

describe('buildJudgeMessages', () => {
  it('sends the structured profile and trimmed vacancies, nothing else', () => {
    const [system, user] = buildJudgeMessages(FRONTEND, [vacancy('1', 'Frontend', 'x'.repeat(5000))]);
    expect(system!.content).toContain('JSON only');
    const payload = JSON.parse(user!.content);
    expect(payload.candidate).toEqual({
      role: 'Senior Frontend Developer',
      grade: 'senior',
      skills: ['React (core)', 'TypeScript (core)', 'Next.js (core)', 'Redux'],
    });
    expect(payload.vacancies[0].description).toHaveLength(700);
    expect(Object.keys(payload.vacancies[0])).toEqual(['id', 'title', 'company', 'location', 'description']);
  });
});

describe('parseVerdicts', () => {
  const good = { id: '1', engineering: false, family: 'SEO', fit: '12', language: 'EN', titleKeyword: ' SEO ', reason: 'r' };

  it('reads JSON wrapped in a code fence and normalizes it', () => {
    const [v] = parseVerdicts('```json\n' + JSON.stringify({ verdicts: [good] }) + '\n```', ['1']);
    expect(v).toEqual({ ...good, family: 'seo', fit: 12, language: 'en', titleKeyword: 'seo' });
  });

  it('drops unknown ids, duplicates and malformed items', () => {
    const verdicts = parseVerdicts(
      JSON.stringify({ verdicts: [good, { ...good, fit: 99 }, { ...good, id: '2' }, { id: '3', fit: 'x' }] }),
      ['1', '3'],
    );
    expect(verdicts.map((v) => [v.id, v.fit])).toEqual([['1', 12]]);
  });

  it('maps a family outside the list to other', () => {
    expect(parseVerdicts(JSON.stringify({ verdicts: [{ ...good, family: 'legal' }] }), ['1'])[0]!.family).toBe('other');
  });

  it('returns nothing for prose', () => {
    expect(parseVerdicts('I cannot help with that', ['1'])).toEqual([]);
  });
});

describe('judgeProviders', () => {
  it('puts GitHub Models first and skips providers without a key', () => {
    expect(judgeProviders({ GITHUB_TOKEN: 't', GEMINI_API_KEY: 'g' }).map((p) => p.name)).toEqual([
      'github-models',
      'gemini',
    ]);
  });
});

describe('callJudge', () => {
  const providers = judgeProviders({ GITHUB_TOKEN: 't', GROQ_API_KEY: 'g' });
  const ok = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

  const noWait = jest.fn().mockResolvedValue(undefined);

  it('waits out a per-minute quota and retries the same provider', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'retry-after': '7' } }))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(ok('{"verdicts":[]}'));
    await expect(callJudge([], providers, new Set(), fetchImpl, noWait)).resolves.toMatchObject({
      provider: 'github-models',
    });
    expect(noWait.mock.calls.map(([ms]) => ms)).toEqual([7500, 30000]);
  });

  it('gives a provider up after the last try, or on a wait that long', async () => {
    const dead = new Set<string>();
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(new Response('daily quota', { status: 429, headers: { 'retry-after': '3600' } }))
      .mockResolvedValueOnce(ok('{"verdicts":[]}'));
    await expect(callJudge([], providers, dead, fetchImpl, noWait)).resolves.toMatchObject({ provider: 'groq' });
    expect(dead).toEqual(new Set(['github-models']));
  });

  it('computes the retry delay', () => {
    expect(retryDelayMs('2', 1)).toBe(2500);
    expect(retryDelayMs(null, 1)).toBe(15000);
    expect(retryDelayMs(null, 9)).toBe(65000);
  });

  it('falls over to the next provider and remembers the dead one', async () => {
    const dead = new Set<string>();
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(ok('{"verdicts":[]}'))
      .mockResolvedValueOnce(ok('{"verdicts":[]}'));
    await expect(callJudge([], providers, dead, fetchImpl)).resolves.toEqual({
      content: '{"verdicts":[]}',
      provider: 'groq',
    });
    await callJudge([], providers, dead, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2][0]).toContain('groq');
  });

  it('skips a provider whose 200 answer is not JSON', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(new Response('OK\n', { status: 200, headers: { 'content-type': 'text/plain' } }))
      .mockResolvedValueOnce(ok('{"verdicts":[]}'));
    await expect(callJudge([], providers, new Set(), fetchImpl)).resolves.toMatchObject({ provider: 'groq' });
  });

  it('sends the GitHub API headers to GitHub Models', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(ok('{"verdicts":[]}'));
    await callJudge([], providers, new Set(), fetchImpl);
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ 'X-GitHub-Api-Version': '2022-11-28' });
  });

  it('returns null when every provider fails', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('down'));
    await expect(callJudge([], providers, new Set(), fetchImpl)).resolves.toBeNull();
  });
});
