"""Permission/counter feasibility only: no CPU sampling or attribution claim."""
import ctypes
import fcntl
import json
import os
import platform
import shutil
import struct
import time
from pathlib import Path

result = {'machine': platform.machine(), 'perfBinary': shutil.which('perf'),
          'perfEventParanoid': Path('/proc/sys/kernel/perf_event_paranoid').read_text().strip(), 'events': []}
if platform.machine() == 'x86_64':
    libc = ctypes.CDLL(None, use_errno=True)
    for name, event_type, config in [('software-task-clock', 1, 1), ('hardware-cpu-cycles', 0, 0)]:
        attr = ctypes.create_string_buffer(128)
        struct.pack_into('IIQQQQQ', attr, 0, event_type, 128, config, 0, 0, 0, 1 | (1 << 5) | (1 << 6))
        ctypes.set_errno(0)
        fd = libc.syscall(298, ctypes.byref(attr), 0, -1, -1, 0)
        err = ctypes.get_errno()
        event = {'event': name, 'attrBytes': 128, 'pid': 0, 'cpu': -1, 'excludeKernel': True,
                 'excludeHypervisor': True, 'opened': fd >= 0, 'errno': err,
                 'error': os.strerror(err) if fd < 0 else None}
        if fd >= 0:
            try:
                fcntl.ioctl(fd, 0x2400, 0)
                started = time.process_time()
                while time.process_time() - started < .05:
                    sum(range(2000))
                fcntl.ioctl(fd, 0x2401, 0)
                event['counter'] = struct.unpack('Q', os.read(fd, 8))[0]
            except OSError as error:
                event['readError'] = str(error)
            finally:
                os.close(fd)
        result['events'].append(event)
else:
    result['unsupportedProbeArchitecture'] = True
result['attribution'] = 'unavailable: this counter probe does not collect symbolized CPU samples'
print(json.dumps(result, indent=2))
