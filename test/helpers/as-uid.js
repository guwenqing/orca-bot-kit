// Loaded with `node --import` ahead of the kit, by `asUid` in
// ps-locale.test.js: the process takes OBK_TEST_UID for what
// `process.getuid()` gives. Node gives a uid as an unsigned 32-bit number, so a
// user whose uid is 2^31 or more, such as 4294967294, has it so here too,
// while Apple's ps prints the same uid signed, as -2 (the second review of
// PR #807). The fakes the kit starts load this file too, through
// NODE_OPTIONS, so the fake ps, lsof and kill take the same uid for the
// user's own. Without the variable it changes nothing.

const uid = process.env.OBK_TEST_UID;
if (uid !== undefined && uid !== '') {
  const value = Number(uid);
  process.getuid = () => value;
}
