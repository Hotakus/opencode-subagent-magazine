#!/usr/bin/env python3
"""Linux/PTY A/B benchmark. Uses an existing session; never submits a prompt.

Only process-local CLI overrides are used. Existing TUIs and the service are not
stopped. Normal plugin startup can still update its own persistence, so back up
history before running against a live installation.
"""
import argparse
import collections
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import pty
import select
import signal
import struct
import subprocess
import termios
import time


def refresh_mode():
    state = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state'))
    file = state / 'opencode/latest/tui/plugin.opencode-subagent-magazine.subagent_magazine.subagent_magazine.refresh_mode.json'
    try:
        return json.loads(file.read_text()).get('value')
    except (OSError, ValueError, AttributeError):
        return None


def process_stats(pid):
    fields = (Path('/proc') / str(pid) / 'stat').read_text().rsplit(') ', 1)[1].split()
    return int(fields[11]) + int(fields[12]), int(fields[21]) * os.sysconf('SC_PAGE_SIZE')


def drain(master):
    while select.select([master], [], [], 0)[0]:
        try:
            data = os.read(master, 1048576)
        except (BlockingIOError, OSError):
            return
        if not data:
            return
        # Answer terminal probes, but do not retain or print rendered history.
        for probe, response in [
            (b'\x1b[6n', b'\x1b[1;1R'),
            (b'\x1b[c', b'\x1b[?1;2c'), (b'\x1b[0c', b'\x1b[?1;2c'),
            (b'\x1b[>c', b'\x1b[>0;276;0c'), (b'\x1b[>0c', b'\x1b[>0;276;0c'),
        ]:
            if probe in data:
                os.write(master, response)
        for code, color in [(10, b'rgb:eeee/eeee/eeee'), (11, b'rgb:1111/1111/1111')]:
            if f'\x1b]{code};?'.encode() in data:
                os.write(master, f'\x1b]{code};'.encode() + color + b'\x1b\\')


def profile_summary(file, expected_url):
    profile = json.loads(file.read_text())
    nodes = {node['id']: node for node in profile['nodes']}
    paths = {node['callFrame'].get('url', '') for node in nodes.values()
             if expected_url in node['callFrame'].get('url', '') or
             'subagent-magazine' in node['callFrame'].get('url', '')}
    verified = bool(paths) and all(expected_url in path for path in paths)
    totals = collections.Counter()
    for node_id, duration in zip(profile.get('samples', []), profile.get('timeDeltas', [])):
        totals[nodes[node_id]['callFrame'].get('functionName', '')] += duration
    total = sum(totals.values()) or 1
    return {
        'implementationVerified': verified,
        'jsonSelfPct': round((totals['parse'] + totals['stringify']) / total * 100, 2),
        'topSelfFunctions': [{'function': name, 'percent': round(value / total * 100, 2)}
                             for name, value in totals.most_common(8)],
    }


def with_subagent_target(plugins, local, target):
    """Inline arrays replace global arrays: retain every unrelated directive."""
    packages = {str(local.resolve()), local.resolve().as_uri()}
    result = []
    replaced = False
    for entry in plugins:
        package = entry if isinstance(entry, str) else entry.get('package', '')
        if package in packages or package == 'opencode-subagent-magazine' or package.startswith('opencode-subagent-magazine@'):
            if not replaced:
                result.append({**entry, 'package': target} if isinstance(entry, dict) else target)
                replaced = True
        else:
            result.append(entry)
    if not replaced:
        result.append(target)
    return result


def run(args, label, target, expected_url, logs):
    mode_before = refresh_mode()
    inline = {'plugins': with_subagent_target(args.plugins, args.local, target), 'tabs': {'mode': 'off'}}
    env = {**os.environ, 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor',
           'OPENCODE_CLI_CONFIG_CONTENT': json.dumps(inline)}
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 52, 180, 0, 0))
    os.set_blocking(master, False)
    process = subprocess.Popen(['opencode', '--session', args.session], cwd=args.directory,
                               env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    try:
        deadline = time.monotonic() + args.warmup
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f'{label} exited during warmup: {process.returncode}')
            drain(master)
            time.sleep(.02)
        profile_started = time.time()
        os.kill(process.pid, signal.SIGPROF)
        before, _ = process_stats(process.pid)
        started = time.monotonic()
        rss = []
        while time.monotonic() - started < args.seconds:
            if process.poll() is not None:
                raise RuntimeError(f'{label} exited during sampling: {process.returncode}')
            drain(master)
            rss.append(process_stats(process.pid)[1])
            time.sleep(.02)
        after, _ = process_stats(process.pid)
        elapsed = time.monotonic() - started
        row = {'variant': label, 'pid': process.pid, 'sampleSeconds': round(elapsed, 2),
               'cpuPctOneCore': round((after - before) / os.sysconf('SC_CLK_TCK') / elapsed * 100, 2),
               'rssMiBMean': round(sum(rss) / len(rss) / 1048576, 1),
               'refreshModeBefore': mode_before, 'refreshModeAfter': refresh_mode()}
        profiles = [p for p in logs.glob(f'cpu-{process.pid}-*.cpuprofile')
                    if p.stat().st_mtime >= profile_started - 1]
        if profiles:
            file = max(profiles, key=lambda p: p.stat().st_mtime)
            row['profile'] = str(file)
            row.update(profile_summary(file, expected_url))
        else:
            row['implementationVerified'] = False
        print(json.dumps(row), flush=True)
        return row
    finally:
        # Terminate only the client created above. No prompts were sent.
        if process.poll() is None:
            os.write(master, b'\x03')
            deadline = time.monotonic() + 5
            while process.poll() is None and time.monotonic() < deadline:
                drain(master)
                time.sleep(.02)
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
        os.close(master)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--session', required=True, help='Existing historical session, verified before startup')
    parser.add_argument('--directory', type=Path, required=True, help='Directory associated with that session')
    parser.add_argument('--base', type=Path, required=True, help='Built, unmodified upstream worktree')
    parser.add_argument('--local', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--npm-version', default='1.7.2')
    parser.add_argument('--rounds', type=int, default=3)
    parser.add_argument('--warmup', type=float, default=20)
    parser.add_argument('--seconds', type=float, default=13, help='Must exceed the profiler\'s ten-second window')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.rounds < 1 or args.warmup < 0 or args.seconds < 12:
        parser.error('Use positive rounds, nonnegative warmup and at least 12 seconds of sampling')
    if args.output.exists():
        parser.error('Output already exists; select a new path to preserve earlier evidence')
    for path in [args.base, args.local]:
        if not (path / 'dist/v2.js').exists():
            parser.error(f'Build the plugin first: {path}')
    # --session may create a session for an absent ID. Never run it without this check.
    check = subprocess.run(['opencode', 'api', 'get', f'/api/session/{args.session}'],
                           cwd=args.directory, capture_output=True, text=True, timeout=30)
    if check.returncode:
        raise SystemExit('Session verification failed; no temporary TUI started')
    config = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'opencode/cli.json'
    logs = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share')) / 'opencode/log'
    args.plugins = json.loads(config.read_text()).get('plugins', []) if config.exists() else []
    report = {'method': {
        'opencodeVersion': subprocess.check_output(['opencode', '--version'], text=True).strip(),
        'platform': platform.platform(), 'warmupSeconds': args.warmup, 'sampleSeconds': args.seconds,
        'roundsPerVariant': args.rounds, 'terminalRows': 52, 'terminalColumns': 180,
        'cpuDefinition': 'Percent of one logical CPU core from /proc/<pid>/stat',
        'memoryDefinition': 'Mean RSS of the temporary CLI process during the sample, MiB',
        'allOtherConfiguredPluginsRetained': True, 'configuredPluginDirectives': len(args.plugins),
        'promptsSent': 0, 'historyClearCommands': 0,
        'cliConfigSHA256': hashlib.sha256(config.read_bytes()).hexdigest() if config.exists() else None,
        'localBundleSHA256': hashlib.sha256((args.local / 'dist/v2.js').read_bytes()).hexdigest(),
        'baseBundleSHA256': hashlib.sha256((args.base / 'dist/v2.js').read_bytes()).hexdigest(),
        'npmVersion': args.npm_version,
    }, 'runs': []}
    variants = [
        ('npm', f'opencode-subagent-magazine@{args.npm_version}', f'/opencode-subagent-magazine@{args.npm_version}/'),
        ('upstream-base', str(args.base.resolve()), (args.base.resolve() / 'dist/v2.js').as_uri()),
        ('current', str(args.local.resolve()), (args.local.resolve() / 'dist/v2.js').as_uri()),
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for round_index in range(args.rounds):
        # Rotate the start and reverse every other round to reduce order effects.
        order = variants[round_index % 3:] + variants[:round_index % 3]
        if round_index % 2:
            order = list(reversed(order))
        for label, target, expected_url in order:
            row = run(args, label, target, expected_url, logs)
            row['round'] = round_index + 1
            report['runs'].append(row)
            args.output.write_text(json.dumps(report, indent=2) + '\n')
    if not all(row['implementationVerified'] for row in report['runs']):
        raise SystemExit('At least one profile did not verify the expected implementation; inspect before claiming results')
    modes = {row[key] for row in report['runs'] for key in ['refreshModeBefore', 'refreshModeAfter']}
    if len(modes) != 1:
        raise SystemExit('Refresh mode changed during the benchmark; do not compare mixed settings')
    if config.exists() and hashlib.sha256(config.read_bytes()).hexdigest() != report['method']['cliConfigSHA256']:
        raise SystemExit('CLI configuration changed during the benchmark; inspect before claiming results')
    for path, key in [(args.local, 'localBundleSHA256'), (args.base, 'baseBundleSHA256')]:
        if hashlib.sha256((path / 'dist/v2.js').read_bytes()).hexdigest() != report['method'][key]:
            raise SystemExit('A bundle changed during the benchmark; do not compare mixed implementations')
    print(f'RESULT_FILE {args.output}', flush=True)


if __name__ == '__main__':
    main()
