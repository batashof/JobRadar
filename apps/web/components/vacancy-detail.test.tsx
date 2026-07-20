import type { VacancyDetail } from '@jobradar/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
});
