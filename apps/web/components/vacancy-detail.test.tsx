import type { VacancyDetail } from '@jobradar/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateBrief, generateCoverLetter, matchResume, fetchGmailStatus } = vi.hoisted(() => ({
  generateBrief: vi.fn(),
  generateCoverLetter: vi.fn(),
  matchResume: vi.fn(),
  fetchGmailStatus: vi.fn(),
}));

vi.mock('@/lib/vacancies', () => ({ generateBrief, generateCoverLetter, matchResume }));
vi.mock('@/lib/outreach', () => ({
  fetchGmailStatus,
  startGmailOauth: vi.fn(),
  draftApplyEmail: vi.fn(),
  sendApplyEmail: vi.fn(),
}));

import { VacancyDetailView } from './vacancy-detail';

function detail(overrides: Partial<VacancyDetail> = {}): VacancyDetail {
  return {
    id: 'v1',
    url: 'https://t.me/job_react/100',
    title: 'Senior React Developer',
    company: 'Acme',
    description: 'Line one.\nLine two with details.',
    source: 'telegram',
    workFormat: 'remote',
    employmentType: 'full_time',
    salaryMin: 4000,
    salaryMax: 6000,
    salaryCurrency: 'USD',
    location: 'Remote',
    publishedAt: '2026-07-18T00:00:00.000Z',
    applyContact: null,
    summaryRu: null,
    ingestedAt: '2026-07-18T01:00:00.000Z',
    ...overrides,
  };
}

describe('VacancyDetailView', () => {
  beforeEach(() => {
    fetchGmailStatus.mockResolvedValue({ configured: false, connected: false });
  });
  afterEach(() => vi.clearAllMocks());

  it('renders the full description and the outbound link', () => {
    render(<VacancyDetailView detail={detail()} />);

    expect(screen.getByRole('heading', { name: 'Senior React Developer' })).toBeTruthy();
    expect(screen.getByText(/Line two with details/)).toBeTruthy();
    const original = screen.getByRole('link', { name: /Open original/ });
    expect(original.getAttribute('href')).toBe('https://t.me/job_react/100');
    expect(screen.getByText('4000–6000 USD')).toBeTruthy();
  });

  it('shows no contact block when none was extracted', () => {
    render(<VacancyDetailView detail={detail()} />);
    expect(screen.queryByText(/Apply contact/)).toBeNull();
  });

  it('links an email contact via mailto', () => {
    render(
      <VacancyDetailView
        detail={detail({ applyContact: { kind: 'email', value: 'hr@acme.dev' } })}
      />,
    );
    const link = screen.getByRole('link', { name: 'hr@acme.dev' });
    expect(link.getAttribute('href')).toBe('mailto:hr@acme.dev');
  });

  it('links a telegram contact via t.me', () => {
    render(
      <VacancyDetailView
        detail={detail({ applyContact: { kind: 'telegram', value: '@acme_hr' } })}
      />,
    );
    const link = screen.getByRole('link', { name: '@acme_hr' });
    expect(link.getAttribute('href')).toBe('https://t.me/acme_hr');
  });

  it('renders a cached Russian brief without calling the API', () => {
    render(<VacancyDetailView detail={detail({ summaryRu: 'Компания делает X.' })} />);
    expect(screen.getByText('Компания делает X.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сгенерировать заново' })).toBeTruthy();
    expect(generateBrief).not.toHaveBeenCalled();
  });

  it('generates a brief on click', async () => {
    generateBrief.mockResolvedValue({
      summaryRu: 'Свежий бриф.',
      generatedAt: '2026-07-21T00:00:00.000Z',
      cached: false,
    });
    render(<VacancyDetailView detail={detail()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать бриф' }));

    await waitFor(() => expect(screen.getByText('Свежий бриф.')).toBeTruthy());
    expect(generateBrief).toHaveBeenCalledWith('v1', false);
  });

  it('generates an editable cover letter on click', async () => {
    generateCoverLetter.mockResolvedValue({ coverLetter: 'Dear Acme team, …' });
    render(<VacancyDetailView detail={detail()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate cover letter' }));

    const textarea = await screen.findByRole('textbox', { name: 'Cover letter' });
    expect((textarea as HTMLTextAreaElement).value).toBe('Dear Acme team, …');

    fireEvent.change(textarea, { target: { value: 'Edited letter' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('Edited letter');
  });

  it('renders a cached resume-fit score without calling the API', () => {
    render(
      <VacancyDetailView
        detail={detail({ resumeScore: 0.72, resumeExplanation: 'React совпал, нет Go.' })}
      />,
    );
    expect(screen.getByText('72%')).toBeTruthy();
    expect(screen.getByText('React совпал, нет Go.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Пересчитать' })).toBeTruthy();
    expect(matchResume).not.toHaveBeenCalled();
  });

  it('scores the vacancy against the resume on click', async () => {
    matchResume.mockResolvedValue({ score: 0.4, explanation: 'Частичное совпадение.', cached: false });
    render(<VacancyDetailView detail={detail()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Оценить по резюме' }));

    await waitFor(() => expect(screen.getByText('40%')).toBeTruthy());
    expect(matchResume).toHaveBeenCalledWith('v1');
    expect(screen.getByText('Частичное совпадение.')).toBeTruthy();
  });

  it('surfaces generation errors (e.g. no LLM provider configured)', async () => {
    generateCoverLetter.mockRejectedValue(new Error('No LLM provider configured'));
    render(<VacancyDetailView detail={detail()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate cover letter' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('No LLM provider configured'),
    );
  });
});
