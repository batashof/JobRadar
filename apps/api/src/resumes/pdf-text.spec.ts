import { looksLikePdf, normalizeExtractedText } from './pdf-text';

describe('looksLikePdf', () => {
  it('accepts a buffer starting with the PDF magic', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7 rest of file'))).toBe(true);
  });

  it('rejects non-PDF content and short buffers', () => {
    expect(looksLikePdf(Buffer.from('<html>not a pdf</html>'))).toBe(false);
    expect(looksLikePdf(Buffer.from('%PD'))).toBe(false);
    expect(looksLikePdf(Buffer.alloc(0))).toBe(false);
  });
});

describe('normalizeExtractedText', () => {
  it('normalizes line endings and trailing whitespace', () => {
    expect(normalizeExtractedText('a  \r\nb\t\nc\r')).toBe('a\nb\nc');
  });

  it('collapses blank-line runs and trims the edges', () => {
    expect(normalizeExtractedText('\n\nSummary\n\n\n\n\nExperience\n\n')).toBe(
      'Summary\n\nExperience',
    );
  });
});
