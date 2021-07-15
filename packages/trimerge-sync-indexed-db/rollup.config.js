// rollup.config.js
import pkg from './package.json';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-typescript2';
import { dependencies } from './package.json';

export default {
  input: 'src/index.ts',
  external: Object.keys(dependencies),
  plugins: [
    commonjs(),
    resolve({ browser: true }),
    typescript({ exclude: '**/*.test.ts' }),
  ],
  output: [
    {
      file: pkg.main,
      format: 'cjs',
    },
    {
      file: pkg.module,
      format: 'esm',
    },
  ],
};
