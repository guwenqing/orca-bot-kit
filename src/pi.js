// Whether Pi is ready to start a session: it runs, it can use a model, and it
// can use the one the session names (#578).
//
// The kit never handles Pi's credentials: the user signs in to Pi on their own,
// and the kit only asks Pi what it can use. `pi auth check` is not asked, since
// it does not know a provider an extension of Pi's brings, such as Cursor's;
// `pi --list-models` lists the models Pi can use, those included (tech notes,
// section 6).

import { spawnSync } from 'node:child_process';

/** How long each question to Pi is given. Each took about 0.3 s on Pi 1.1.0. */
const ASK_MS = 30_000;

/** Pi's thinking levels, which a model name may carry after a colon. */
const THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Why Pi cannot start these sessions, or undefined when it can. `models` are
 * the models they name; a session that names none takes Pi's own default.
 */
export function piTrouble(models) {
  const pi = askPi();
  const runs = pi.runs();
  if (runs !== undefined) return `Pi does not run here (${runs}), so no Pi session was started. Install Pi, then run this again.`;
  if (!pi.hasModels()) {
    return 'Pi has no model it can use: it is signed in to no provider. Sign in to Pi yourself (start pi and use /login, or set a provider\'s API key), then run this again. The kit never handles Pi\'s credentials.';
  }
  for (const model of new Set(models)) {
    const found = pi.model(model);
    if (found.failed !== undefined) {
      return `Pi cannot say whether it can use the model ${model}: pi --list-models ${found.search} failed (${found.failed}), so no Pi session was started. Run that command yourself to see why, then run this again.`;
    }
    if (!found.listed) {
      return `Pi cannot use the model ${model}: pi --list-models lists none matching it. Sign in to its provider in Pi yourself, or give the session a model Pi lists.`;
    }
  }
  return undefined;
}

/**
 * Pi's answers, each question asked once however often it is asked here: for
 * a caller that asks about many sessions, as `obk health` does (#660).
 *
 * - `runs()`: undefined when `pi --version` answers, or why it does not.
 * - `hasModels()`: whether `pi --list-models` lists any model.
 * - `model(m)`: `{ search, listed }`, whether `pi --list-models <search>` lists
 *   a model matching `m` without its thinking level, or `{ search, failed }`
 *   with why that question failed.
 */
export function askPi() {
  const asked = new Map();
  const once = (args) => {
    const key = args.join('\0');
    if (!asked.has(key)) asked.set(key, ask(args));
    return asked.get(key);
  };
  return {
    runs() {
      const version = once(['--version']);
      if (version.error === undefined && version.status === 0) return undefined;
      return version.error?.code === 'ENOENT' ? 'there is no pi on PATH' : (version.error?.message ?? ((version.stderr ?? '').trim() || `it exited with ${version.status}`));
    },
    hasModels() {
      const any = once(['--list-models']);
      return any.error === undefined && any.status === 0 && !/^No models available\b/m.test(any.stdout ?? '');
    },
    model(model) {
      const search = withoutThinking(model);
      const found = once(['--list-models', search]);
      if (found.error !== undefined || found.status !== 0) {
        return { search, failed: found.error?.message ?? ((found.stderr ?? '').trim() || `it exited with ${found.status ?? found.signal}`) };
      }
      // Pi says it has no model at all before it searches, so the answer may be
      // that one too, when a provider dropped out since the question above.
      return { search, listed: !/^No models (matching|available)\b/m.test(found.stdout ?? '') };
    },
  };
}

/** The model without a trailing `:<thinking level>`, which `--list-models` does not match. */
export function withoutThinking(model) {
  const at = model.lastIndexOf(':');
  return at > 0 && THINKING.includes(model.slice(at + 1)) ? model.slice(0, at) : model;
}

const ask = (args) => spawnSync('pi', args, { encoding: 'utf8', timeout: ASK_MS });
