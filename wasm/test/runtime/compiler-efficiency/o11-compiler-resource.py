"""Linux-only, one compiler child: preserve streams and report wait4 resource use."""
import json
import resource
import subprocess
import sys
import time

started = time.perf_counter()
child = subprocess.run(sys.argv[2:], check=False)
usage = resource.getrusage(resource.RUSAGE_CHILDREN)
with open(sys.argv[1], 'w', encoding='utf-8') as output:
    json.dump({'wallMs': (time.perf_counter() - started) * 1000,
               'userMs': usage.ru_utime * 1000, 'systemMs': usage.ru_stime * 1000,
               'peakRssBytes': usage.ru_maxrss * 1024}, output)
sys.exit(child.returncode if child.returncode >= 0 else 128 - child.returncode)
