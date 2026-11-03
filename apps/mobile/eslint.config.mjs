import tseslint from 'typescript-eslint';
export default tseslint.config(
  ...tseslint.configs.recommended,
  { ignores: ['.expo/**', 'dist/**', 'uniwind-types.d.ts'] },
  { rules: { '@typescript-eslint/no-require-imports': ['error', { allow: ['\\.png$'] }] } },
);
