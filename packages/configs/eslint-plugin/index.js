import eslint from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/*.gen.*'],
  },
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    plugins: {'@stylistic': stylistic},
    rules: {
      '@stylistic/member-delimiter-style': 'error',
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/semi': 'error',
      '@stylistic/type-annotation-spacing': 'error',
    },
  },
  {
    plugins: {'simple-import-sort': simpleImportSort},
    rules: {
      'simple-import-sort/exports': 'error',
      'simple-import-sort/imports': 'error',
      'sort-imports': 'off',
    },
  },
  {
    plugins: {'unused-imports': unusedImports},
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },
  {
    rules: {
      '@typescript-eslint/array-type': ['error', {
        default: 'array',
        readonly: 'generic',
      }],
      '@typescript-eslint/consistent-indexed-object-style': 'off',
      '@typescript-eslint/consistent-type-assertions': ['error', {
        assertionStyle: 'as',
        objectLiteralTypeAssertions: 'never',
      }],
      '@typescript-eslint/consistent-type-definitions': ['error',
        'interface',
      ],
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowConciseArrowFunctionExpressionsStartingWithVoid: true,
        allowExpressions: true,
      }],
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off', // Prevents void operator
      '@typescript-eslint/no-misused-new': 'error',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/no-useless-constructor': 'error',
      '@typescript-eslint/prefer-function-type': 'error',
      '@typescript-eslint/prefer-optional-chain': 'off', // Requires typing
      '@typescript-eslint/unified-signatures': 'error',
      'arrow-parens': 'error',
      'consistent-return': 'error',
      'comma-dangle': ['error', {
        'arrays': 'always-multiline',
        'objects': 'always-multiline',
        'imports': 'always-multiline',
        'exports': 'always-multiline',
        'functions': 'never',
      }],
      'curly': 'error',
      'default-case-last': 'error',
      'default-param-last': 'error',
      'dot-location': ['error', 'property'],
      'dot-notation': 'off', // https://234.fyi/1PcbRPGcR
      'eqeqeq': ['error', 'smart'],
      'max-len': ['error', {
        code: 100, // Add padding due to prettier sometimes going over
        comments: 80,
        ignorePattern: 'eslint-disable',
        ignoreTrailingComments: true,
        ignoreUrls: true,
      }],
      'no-alert': 'error',
      'no-caller': 'error',
      'no-constructor-return': 'error',
      'no-duplicate-imports': 'error',
      'no-else-return': 'error',
      'no-eq-null': 'off', // Handled by eqeqeq.
      'no-eval': 'error',
      'no-extra-bind': 'error',
      'no-extra-label': 'error',
      'no-implicit-globals': 'error',
      'no-implied-eval': 'error',
      'no-label-var': 'error',
      'no-loss-of-precision': 'error',
      'no-multi-spaces': 'error',
      'no-new-wrappers': 'error',
      'no-promise-executor-return': 'error',
      'no-restricted-globals': [
        // https://github.com/microsoft/TypeScript/issues/18433
        'error',
        'closed',
        'event',
        'fdescribe',
        'length',
        'location',
        'name',
        'parent',
        'top',
      ],
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-tabs': 'error',
      'no-throw-literal': 'error',
      'no-trailing-spaces': 'error',
      'no-undef-init': 'error',
      'no-unneeded-ternary': ['error', {defaultAssignment: false}],
      'no-unused-expressions': 'off',
      'no-useless-call': 'error',
      'no-useless-computed-key': 'error',
      'no-useless-rename': 'error',
      'no-var': 'error',
      'no-whitespace-before-property': 'error',
      'object-shorthand': ['error', 'always', {avoidQuotes: true}],
      'prefer-const': 'error',
      'radix': 'error',
      'require-await': 'off',
    },
  },
  {
    files: ['**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
    }
  },
);
