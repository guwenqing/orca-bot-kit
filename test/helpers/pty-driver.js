// The pty driver of a system test that runs a real harness in a pty of its own
// (test/system/codex-update-offer.test.js). Node has no pty of its own, and the
// kit takes no dependency for one, so it is a short Python script, run with
// `python3 -I`.
//
// It forks the child in a new pty, sets the window to 40 rows by 120 columns
// before it starts the command, reads for `seconds`, answers each
// cursor-position query (`ESC[6n` gets `ESC[1;1R`) and writes nothing else.
// When the pty closes, it waits for the child to end, up to the end of the
// window: the child can close the pty a moment before it is reaped (#692).
// A child that still runs at the end of the window gets SIGKILL by the pid the
// fork gave it, and the driver waits for it.
//
// The new pty puts the child in a session of its own, out of reach of the
// runner's hard stop (#653), which kills the driver. So the driver sets an
// alarm in the child before it starts the command: the alarm stays set across
// exec, and the child ends by SIGALRM after `life` seconds even when the driver
// is gone (#655).

/** The script. Arguments: seconds, life, output file, report file, pid file, cwd, then the command. */
export const PTY_DRIVER = `
import fcntl, json, os, pty, select, signal, struct, sys, termios, time

seconds = float(sys.argv[1])
life = int(sys.argv[2])
out_path, report_path, pid_path, cwd = sys.argv[3:7]
command = sys.argv[7:]

pid, fd = pty.fork()
if pid == 0:
    try:
        signal.alarm(life)
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
        os.chdir(cwd)
        os.execvp(command[0], command)
    finally:
        os._exit(127)

with open(pid_path, 'w') as f:
    f.write(str(pid))

QUERY = b'\\x1b[6n'
ANSWER = b'\\x1b[1;1R'
screen = bytearray()
writes = []
queries = 0
scanned = 0
ended = False
deadline = time.monotonic() + seconds
while True:
    left = deadline - time.monotonic()
    if left <= 0:
        break
    ready, _, _ = select.select([fd], [], [], min(left, 0.5))
    if not ready:
        continue
    try:
        chunk = os.read(fd, 65536)
    except OSError:
        chunk = b''
    if not chunk:
        ended = True
        break
    screen += chunk
    while True:
        at = screen.find(QUERY, scanned)
        if at < 0:
            scanned = max(scanned, len(screen) - len(QUERY) + 1)
            break
        queries += 1
        scanned = at + len(QUERY)
        os.write(fd, ANSWER)
        writes.append(ANSWER.hex())

done, status = os.waitpid(pid, os.WNOHANG)
while done == 0 and time.monotonic() < deadline:
    time.sleep(0.01)
    done, status = os.waitpid(pid, os.WNOHANG)
killed = False
if done == 0:
    os.kill(pid, signal.SIGKILL)
    killed = True
    done, status = os.waitpid(pid, 0)

with open(out_path, 'wb') as f:
    f.write(bytes(screen))
with open(report_path, 'w') as f:
    json.dump({'pid': pid, 'queries': queries, 'writes': writes, 'ended': ended, 'killed': killed, 'status': status}, f)
`;
