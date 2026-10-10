// The kit's commands, each with the flags it cannot do without. `obk` reads it
// to parse a command line, and the default permission set is made from it
// (#527, ADR 0036), so a new command is in that set unless it is named as one
// the user's yes is kept for (ADR 0037).

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
  'session nudge': ['bots', 'bot'],
  'session mail': ['bots', 'bot'],
  'session name': ['bots', 'bot'],
  'session mailbox': ['bots', 'bot', 'session'],
  'temp make': ['bots', 'name'],
  'temp roles': ['bots'],
  'temp retire': ['bots', 'name'],
  'temp trust-hooks': ['bots', 'name'],
  'temp answer': ['bots', 'name'],
};

/**
 * The commands kept out of the default permission set, which keep the user's
 * yes (ADR 0037): the ones that change permissions, close a long-lived
 * session, or make the bots folder.
 */
export const KEPT_BACK = ['init', 'retire', 'pause', 'permission allow', 'permission disallow', 'permission approval'];
