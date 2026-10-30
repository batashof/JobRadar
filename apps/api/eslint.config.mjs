import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        // scripts/ are one-off tsx entry points outside the nest build tsconfig.
        projectService: {
          allowDefaultProject: ['scripts/*.ts'],
          // One per script; the default of 8 was reached with quality-audit.ts.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
