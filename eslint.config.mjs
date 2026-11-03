import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['node_modules/**', 'apps/**', '**/dist/**', '**/.expo/**'] },
  ...tseslint.configs.recommended,
);
