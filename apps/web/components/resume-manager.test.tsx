import type { ResumeItem } from '@jobradar/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { uploadResume, activateResume, deleteResume } = vi.hoisted(() => ({
  uploadResume: vi.fn(),
  activateResume: vi.fn(),
  deleteResume: vi.fn(),
}));

vi.mock('@/lib/resumes', () => ({
  uploadResume,
  activateResume,
  deleteResume,
  resumeFileUrl: (id: string) => `/api/resumes/${id}/file`,
}));

import { ResumeManager } from './resume-manager';

function resume(overrides: Partial<ResumeItem> = {}): ResumeItem {
  return {
    id: 'r1',
    filename: 'cv.pdf',
    isActive: true,
    uploadedAt: '2026-07-20T00:00:00.000Z',
    extractedChars: 2400,
    ...overrides,
  };
}

describe('ResumeManager', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders resumes with the active badge and file link', () => {
    render(<ResumeManager initial={[resume()]} />);
    const link = screen.getByRole('link', { name: 'cv.pdf' });
    expect(link.getAttribute('href')).toBe('/api/resumes/r1/file');
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('shows an empty state without resumes', () => {
    render(<ResumeManager initial={[]} />);
    expect(screen.getByText(/No resume yet/i)).toBeTruthy();
  });

  it('flags resumes whose text extraction failed', () => {
    render(<ResumeManager initial={[resume({ extractedChars: 0 })]} />);
    expect(screen.getByText('No text extracted')).toBeTruthy();
  });

  it('uploads a PDF and prepends it as the only active resume', async () => {
    uploadResume.mockResolvedValue(resume({ id: 'r2', filename: 'new.pdf' }));
    render(<ResumeManager initial={[resume({ id: 'r1', filename: 'old.pdf' })]} />);

    const file = new File(['%PDF-'], 'new.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('resume-file-input'), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByRole('link', { name: 'new.pdf' })).toBeTruthy());
    expect(uploadResume).toHaveBeenCalledWith(file);
    // exactly one Active badge — the fresh upload
    expect(screen.getAllByText('Active')).toHaveLength(1);
  });

  it('surfaces upload errors', async () => {
    uploadResume.mockRejectedValue(new Error('Only PDF files are accepted'));
    render(<ResumeManager initial={[]} />);

    const file = new File(['nope'], 'cv.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('resume-file-input'), { target: { files: [file] } });

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Only PDF files are accepted'),
    );
  });

  it('activates another resume', async () => {
    activateResume.mockResolvedValue(resume({ id: 'r2', isActive: true }));
    render(
      <ResumeManager
        initial={[resume({ id: 'r1' }), resume({ id: 'r2', filename: 'alt.pdf', isActive: false })]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Make active' }));

    await waitFor(() => expect(activateResume).toHaveBeenCalledWith('r2'));
    await waitFor(() => expect(screen.getAllByText('Active')).toHaveLength(1));
  });

  it('deletes a resume after confirmation', async () => {
    deleteResume.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ResumeManager initial={[resume()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteResume).toHaveBeenCalledWith('r1'));
    expect(screen.queryByRole('link', { name: 'cv.pdf' })).toBeNull();
  });
});
