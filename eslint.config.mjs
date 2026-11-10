import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
    {
        ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs', 'src/types/css-highlights.d.ts'],
    },
    js.configs.recommended,
    {
        files: ['**/*.{js,mjs,cjs}'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                ...globals.node,
                chrome: 'readonly',
            },
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        rules: {
            semi: ['error', 'always'],
            quotes: ['error', 'single'],
        },
    },
    ...tseslint.configs.recommendedTypeChecked.map(config => ({
        ...config,
        files: ['**/*.{ts,tsx}'],
    })),
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                chrome: 'readonly',
            },
            ecmaVersion: 2022,
            sourceType: 'module',
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            semi: ['error', 'always'],
            quotes: ['error', 'single'],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
            '@typescript-eslint/no-floating-promises': 'warn',
            '@typescript-eslint/no-misused-promises': 'warn',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/unbound-method': 'off',
        },
    },
];