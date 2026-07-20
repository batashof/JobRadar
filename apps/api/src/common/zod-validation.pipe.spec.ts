import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({ email: z.email(), age: z.number().int().min(0) });
  const pipe = new ZodValidationPipe(schema);

  it('returns parsed data on valid input', () => {
    expect(pipe.transform({ email: 'a@b.com', age: 30 })).toEqual({ email: 'a@b.com', age: 30 });
  });

  it('throws BadRequestException with field errors on invalid input', () => {
    try {
      pipe.transform({ email: 'nope', age: -1 });
      throw new Error('expected pipe to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as {
        errors: { path: string }[];
      };
      const paths = response.errors.map((e) => e.path).sort();
      expect(paths).toEqual(['age', 'email']);
    }
  });
});
