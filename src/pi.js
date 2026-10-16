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
  const version = ask(['--version']);
  if (version.error !== undefined || version.status !== 0) {
    const why = version.error?.code === 'ENOENT' ? 'there is no pi on PATH' : (version.error?.message ?? ((version.stderr ?? '').trim() || `it exited with ${version.status}`));
    return `Pi does not run here (${why}), so no Pi session was started. Install Pi, then run this again.`;
  }

  const any = ask(['--list-models']);
  if (any.error !== undefined || any.status !== 0 || /^No models available\b/m.test(any.stdout ?? '')) {
    return 'Pi has no model it can use: it is signed in to no provider. Sign in to Pi yourself (start pi and use /login, or set a provider\'s API key), then run this again. The kit never handles Pi\'s credentials.';
  }

  for (const model of new Set(models)) {
    const found = ask(['--list-models', withoutThinking(model)]);
    if (found.error === undefined && found.status === 0 && /^No models matching\b/m.test(found.stdout ?? '')) {
      return `Pi cannot use the model ${model}: pi --list-models lists none matching it. Sign in to its provider in Pi yourself, or give the session a model Pi lists.`;
    }
  }
  return undefined;
}

/** The model without a trailing `:<thinking level>`, which `--list-models` does not match. */
function withoutThinking(model) {
  const at = model.lastIndexOf(':');
  return at > 0 && THINKING.includes(model.slice(at + 1)) ? model.slice(0, at) : model;
}

const ask = (args) => spawnSync('pi', args, { encoding: 'utf8', timeout: ASK_MS });
