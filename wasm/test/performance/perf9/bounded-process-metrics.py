"""One isolated build command; RUSAGE_CHILDREN is a peak, never summed RSS."""
import json
import resource
import subprocess
import sys
import time
from pathlib import Path

output, command = sys.argv[1], sys.argv[2:]
started = time.monotonic()
result = subprocess.run(command, check=False)
usage = resource.getrusage(resource.RUSAGE_CHILDREN)
Path(output).write_text(json.dumps({
    'command': command, 'exitCode': result.returncode,
    'wallMs': (time.monotonic() - started) * 1000,
    'peakIndividualRssBytes': usage.ru_maxrss * 1024,
    'userMs': usage.ru_utime * 1000, 'systemMs': usage.ru_stime * 1000,
    'domain': 'Linux waited command/descendants maximum individual RSS, not simultaneous process-tree sum'
}, indent=2) + '\n')
sys.exit(result.returncode)
