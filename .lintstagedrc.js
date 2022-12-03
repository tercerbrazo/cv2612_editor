module.exports = {
  '**/*.+(js|ts|tsx|sass)': [
    'prettier --write',
    'eslint --fix --max-warnings=0 --no-ignore',
  ],
  '**/*.+(md|json)': 'prettier --write',
}
