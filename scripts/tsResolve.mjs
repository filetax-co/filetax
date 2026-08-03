/**
 * Resolve hook so Node can run the app's TypeScript sources directly.
 * Vite resolves extensionless relative imports ('./supabase') and the '@/'
 * alias; plain Node ESM does not. Registered via --import in the verify
 * scripts so they exercise the real source, not a copy.
 */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith('@/')) spec = pathToFileURL(path.join(SRC, spec.slice(2))).href;

    const isRelative = spec.startsWith('./') || spec.startsWith('../');
    const isFileUrl = spec.startsWith('file:');
    if ((isRelative || isFileUrl) && !/\.[a-z]+$/i.test(spec)) {
      const base = isFileUrl
        ? fileURLToPath(spec)
        : path.resolve(path.dirname(fileURLToPath(context.parentURL)), spec);
      for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
        if (existsSync(base + ext)) return nextResolve(pathToFileURL(base + ext).href, context);
      }
      const index = path.join(base, 'index');
      for (const ext of ['.ts', '.tsx', '.js']) {
        if (existsSync(index + ext)) return nextResolve(pathToFileURL(index + ext).href, context);
      }
    }
    return nextResolve(spec, context);
  },
});
