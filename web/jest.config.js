/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      { tsconfig: { ...require('./tsconfig.json').compilerOptions, jsx: 'react-jsx' } },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['<rootDir>/tests/**/*.spec.tsx', '<rootDir>/tests/**/*.spec.ts'],
};

module.exports = config;
