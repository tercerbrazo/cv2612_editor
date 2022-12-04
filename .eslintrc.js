module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  env: {
    es6: true,
    browser: true,
  },
  parserOptions: {
    sourceType: 'module',
    project: ['./tsconfig.eslint.json'],
    ecmaVersion: 2020,
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint'],
  extends: ['airbnb-typescript-prettier', 'plugin:react-hooks/recommended'],
  rules: {
    'import/prefer-default-export': 'off',
    'no-bitwise': 'off',
    camelcase: 'warn',
    'no-plusplus': 'off',
    'jsx-a11y/label-has-associated-control': 'off',
    'jsx-a11y/label-has-associated-label': 'off',
    'no-param-reassign': 'off',
    '@typescript-eslint/no-shadow': 'off',
  },
}
