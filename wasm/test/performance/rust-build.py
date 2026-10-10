#!/usr/bin/env python3
"""Linux wait4 receipt for Cargo and its children; not simultaneous tree RSS."""
import json
import os
import subprocess
import sys
import time

receipt, *command = sys.argv[1:]
started = time.monotonic()
process = subprocess.Popen(command)
_, status, usage = os.wait4(process.pid, 0)
process.returncode = os.waitstatus_to_exitcode(status)
with open(receipt, 'x', encoding='utf-8') as output:
    json.dump({'elapsedMs': (time.monotonic() - started) * 1000,
               'peakRssBytes': usage.ru_maxrss * 1024,
               'exitCode': process.returncode}, output)
sys.exit(process.returncode if process.returncode >= 0 else 128 - process.returncode)
