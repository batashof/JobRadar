import { createIssue, ensureFixLabel, issueOutcome } from './github-issues';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const reply = (status: number, body: unknown = {}) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);

const gh = { repo: 'batashof/JobRadar', token: 'gh-token' };

describe('github issues', () => {
  beforeEach(() => fetchMock.mockReset());

  it('creates the label and accepts that it already exists', async () => {
    fetchMock.mockReturnValue(reply(422));
    await expect(ensureFixLabel(gh)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/batashof/JobRadar/labels');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).name).toBe('agent-fix');
  });

  it('opens an issue with the token and returns its number', async () => {
    fetchMock.mockReturnValue(reply(201, { number: 51 }));
    const number = await createIssue(gh, { title: 't', body: 'b', labels: ['agent-fix', 'bug'] });
    expect(number).toBe(51);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/batashof/JobRadar/issues');
    expect(init.headers.authorization).toBe('Bearer gh-token');
    expect(JSON.parse(init.body as string)).toEqual({ title: 't', body: 'b', labels: ['agent-fix', 'bug'] });
  });

  it('throws with the status when GitHub refuses', async () => {
    fetchMock.mockReturnValue(reply(403, { message: 'Resource not accessible by integration' }));
    await expect(createIssue(gh, { title: 't', body: 'b', labels: [] })).rejects.toThrow('HTTP 403');
  });

  it.each([
    [{ state: 'open' }, 'open'],
    [{ state: 'closed', state_reason: 'completed' }, 'done'],
    [{ state: 'closed', state_reason: 'not_planned' }, 'skip'],
  ])('reads %j as %s', async (issue, outcome) => {
    fetchMock.mockReturnValue(reply(200, issue));
    await expect(issueOutcome(gh, 51)).resolves.toBe(outcome);
  });
});
