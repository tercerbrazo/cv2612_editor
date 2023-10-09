module.exports = {
  globDirectory: 'dist/',
  globPatterns: ['**/*.{css,js,html,png}'],
  swDest: 'dist/sw.js',
  ignoreURLParametersMatching: [/^utm_/, /^fbclid$/],
}
