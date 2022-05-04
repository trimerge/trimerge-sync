// rollup.config.js
import { dependencies, main, module } from './package.json';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-typescript2';

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
      file: main,
      format: 'cjs',
    },
    {
      file: module,
      format: 'esm',
    },
  ],
};
