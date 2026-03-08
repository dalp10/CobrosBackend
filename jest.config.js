/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/config/seed.js', '!src/config/reset_db.js'],
  coverageDirectory: 'coverage',
  verbose: true,
};
