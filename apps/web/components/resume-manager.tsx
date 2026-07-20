'use client';

import { RESUME_MAX_BYTES, type ResumeItem } from '@jobradar/shared';
import { useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { activateResume, deleteResume, resumeFileUrl, uploadResume } from '@/lib/resumes';

export function ResumeManager({ initial }: { initial: ResumeItem[] }) {
  const [resumes, setResumes] = useState<ResumeItem[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > RESUME_MAX_BYTES) {
      setError(`File is too large (max ${Math.round(RESUME_MAX_BYTES / 1024 / 1024)} MB)`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadResume(file);
      // The new upload becomes the active resume server-side.
      setResumes((prev) => [uploaded, ...prev.map((r) => ({ ...r, isActive: false }))]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate(id: string) {
    setError(null);
    try {
      const updated = await activateResume(id);
      setResumes((prev) => prev.map((r) => ({ ...r, isActive: r.id === updated.id })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate');
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this resume?')) return;
    setError(null);
    try {
      await deleteResume(id);
      setResumes((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Resume</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Upload your resume as a PDF. The active one drives matching, cover letters, and
            email applications.
          </p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            data-testid="resume-file-input"
            onChange={(e) => void handleFileChange(e)}
          />
          <Button disabled={busy} onClick={() => fileInputRef.current?.click()}>
            {busy ? 'Uploading…' : 'Upload PDF'}
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      {resumes.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
            No resume yet. Upload a PDF to unlock resume matching and cover letters.
          </CardContent>
        </Card>
      ) : null}

      <ul className="space-y-3">
        {resumes.map((resume) => (
          <li key={resume.id}>
            <Card>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <a
                      href={resumeFileUrl(resume.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-medium hover:underline"
                    >
                      {resume.filename}
                    </a>
                    {resume.isActive ? <Badge variant="primary">Active</Badge> : null}
                    {resume.extractedChars === 0 ? (
                      <Badge variant="destructive">No text extracted</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Uploaded {new Date(resume.uploadedAt).toLocaleDateString()} ·{' '}
                    {resume.extractedChars.toLocaleString()} chars of text
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {!resume.isActive ? (
                    <Button variant="outline" size="sm" onClick={() => void handleActivate(resume.id)}>
                      Make active
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" onClick={() => void handleDelete(resume.id)}>
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
