import pkg from './package.json';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-typescript2';
import { dependencies, peerDependencies } from './package.json';

export default {
  input: 'src/index.ts',
  plugins: [
    commonjs(),
    resolve({ preferBuiltins: true }),
    typescript({ exclude: '**/*.test.ts' }),
  ],
  external: [
    ...new Set([
      ...Object.keys(dependencies),
      ...Object.keys(peerDependencies),
    ]),
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
