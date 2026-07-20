import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        // scripts/ are one-off tsx entry points outside the nest build tsconfig.
        projectService: { allowDefaultProject: ['scripts/*.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
