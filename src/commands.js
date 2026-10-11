// The kit's commands, each with the flags it cannot do without, which `obk`
// reads to parse a command line; and the two lists every command is on one of:
// those every bot is allowed by default (#527, ADR 0036), and those kept back
// for the user's yes (ADR 0041). A new command is on neither until someone
// puts it on one, and a test holds every command to that choice.

/** The commands, and the flags each one cannot do without. */
export const COMMANDS = {
  init: ['bots', 'harness'],
  up: ['bots'],
  restart: ['bots', 'bot'],
  pause: ['bots', 'bot'],
  unpause: ['bots', 'bot'],
  retire: ['bots', 'bot'],
  health: ['bots'],
  groom: ['bots'],
  roster: ['bots'],
  usage: ['bots'],
  'bot create': ['bots', 'name', 'harness'],
  'bot change': ['bots', 'bot'],
  'permission allow': ['bots', 'bot', 'rule'],
  'permission disallow': ['bots', 'bot', 'rule'],
  'permission approval': ['bots', 'bot', 'approval'],
  'rules build': ['bots'],
  'skills add': ['bots', 'bot', 'skill'],
  'skills remove': ['bots', 'bot', 'skill'],
  'skills build': ['bots'],
  'skills fetch': ['bots'],
  'skills update': ['bots'],
  'source add': ['bots', 'name', 'repo', 'ref'],
  'session add': ['bots', 'bot', 'name'],
  'session change': ['bots', 'bot', 'session'],
  'session clear': ['bots', 'bot', 'session'],
  'session compact': ['bots', 'bot', 'session'],
  'message to': ['bots', 'to'],
  'message send': ['bots', 'to', 'subject'],
  'message check': ['bots'],
  'session record': ['bots', 'bot'],
  'session sent': ['bots', 'bot'],
  'session name': ['bots', 'bot'],
  'session mailbox': ['bots', 'bot', 'session'],
  'session trust-hooks': ['bots', 'bot', 'session'],
  'session answer': ['bots', 'bot', 'session'],
  'temp make': ['bots', 'name'],
  'temp roles': ['bots'],
  'temp retire': ['bots', 'name'],
  'temp trust-hooks': ['bots', 'name'],
  'temp answer': ['bots', 'name'],
};

/**
 * The commands every bot is allowed by default, each narrowed to its bots
 * folder (ADR 0036). Only a command named here is in the default set; one that
 * runs whatever its arguments say never is.
 */
export const DEFAULT_COMMANDS = [
  'up', 'unpause', 'health', 'groom', 'roster', 'usage',
  'bot change', 'rules build',
  'skills add', 'skills remove', 'skills build', 'skills fetch', 'skills update', 'source add',
  'session add', 'session change', 'session clear', 'session compact',
  'message to', 'message send', 'message check',
  'session record', 'session sent', 'session name', 'session mailbox',
  'session trust-hooks', 'session answer',
  'temp make', 'temp roles', 'temp retire', 'temp trust-hooks', 'temp answer',
];

/**
 * The commands kept out of the default permission set, which keep the user's
 * yes (ADR 0041): the ones that change permissions, close a long-lived
 * session, make the bots folder, or make a bot, which the owner leaves to Bot
 * Father (#548).
 */
export const KEPT_BACK = [
  'init', 'retire', 'pause', 'restart', 'bot create',
  'permission allow', 'permission disallow', 'permission approval',
];

/**
 * The commands kit 0.26.0 gave every bot by default and that are kept back now
 * (#548). A bot may still hold their rules, which the kit names and leaves.
 */
export const NO_LONGER_DEFAULT = ['restart', 'bot create'];
