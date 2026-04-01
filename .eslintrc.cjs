module.exports = {
  root: true,
  env: { es2022: true, node: true, browser: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  extends: ['eslint:recommended'],
  ignorePatterns: ['dist', 'coverage'],
  rules: {
    'no-console': 'off'
  }
};
