'use strict';
// /proc may be mounted from the outer PID namespace in a container. Publish
// this child's proc identity before executing the synchronous measured work.
const fs = require('node:fs');
if (process.send) process.send({ watchdogIdentity: { pid: process.pid, procPid: fs.readlinkSync('/proc/self') } });
