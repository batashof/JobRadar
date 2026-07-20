import { z } from 'zod';

/**
 * Search-profile contracts shared between web and api. Enum value tuples mirror
 * the Postgres enums in apps/api/src/db/schema.ts — keep them in sync.
 */

export const WORK_FORMATS = ['remote', 'onsite', 'hybrid'] as const;
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'freelance'] as const;

export type WorkFormat = (typeof WORK_FORMATS)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

// Field-level schemas without defaults, so the update schema can be truly partial
// (zod keeps `.default()` values even under `.partial()`, which would clobber
// unspecified fields on a PATCH — so defaults live only on the create schema).
const nameField = z.string().trim().min(1, 'Name is required').max(120);
const tagList = z.array(z.string().trim().min(1).max(60)).max(50);
const workFormatField = z.array(z.enum(WORK_FORMATS)).max(WORK_FORMATS.length);
const employmentTypeField = z.array(z.enum(EMPLOYMENT_TYPES)).max(EMPLOYMENT_TYPES.length);
const salaryField = z.number().int().nonnegative().nullable();
const currencyField = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().length(3, 'Use a 3-letter currency code'))
  .nullable();

const salaryOrdered = (v: { salaryMin?: number | null; salaryMax?: number | null }): boolean =>
  v.salaryMin == null || v.salaryMax == null || v.salaryMin <= v.salaryMax;
const salaryOrderError = { message: 'Minimum salary must be ≤ maximum', path: ['salaryMax'] };

export const profileCreateSchema = z
  .object({
    name: nameField,
    keywords: tagList.default([]),
    stack: tagList.default([]),
    workFormat: workFormatField.default([]),
    employmentType: employmentTypeField.default([]),
    salaryMin: salaryField.default(null),
    salaryMax: salaryField.default(null),
    salaryCurrency: currencyField.default(null),
    isActive: z.boolean().default(true),
  })
  .refine(salaryOrdered, salaryOrderError);

export const profileUpdateSchema = z
  .object({
    name: nameField,
    keywords: tagList,
    stack: tagList,
    workFormat: workFormatField,
    employmentType: employmentTypeField,
    salaryMin: salaryField,
    salaryMax: salaryField,
    salaryCurrency: currencyField,
    isActive: z.boolean(),
  })
  .partial()
  .refine(salaryOrdered, salaryOrderError);

export type ProfileCreateInput = z.infer<typeof profileCreateSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

/** A search profile as serialized by the API (timestamps are ISO strings). */
export interface SearchProfile {
  id: string;
  name: string;
  keywords: string[];
  stack: string[];
  workFormat: WorkFormat[];
  employmentType: EmploymentType[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
