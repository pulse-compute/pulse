'use strict';
// Render only measured oracle counters. No inferred host cost or runtime timing.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const input = fs.readFileSync(process.argv[2]);
const r = JSON.parse(input), output = path.resolve(process.argv[3] || __dirname);
assert.equal(r.status, 'passed'); assert.equal(r.cases.length, 33);
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
// Reject a receipt from different oracle/harness bytes before rendering.
for (const item of r.inputs) assert.equal(sha(fs.readFileSync(path.join(__dirname, item.file))), item.sha256);
const archive = zlib.gzipSync(input, { level: 9 });
const summary = { ...r, fullTrace: { file: 'traces.json.gz', sha256: sha(archive), uncompressedSha256: sha(input) },
  reportSourceSha256: sha(fs.readFileSync(__filename)),
  cases: r.cases.map(({ trace, ...row }) => ({ ...row, events: trace.length, traceSha256: sha(JSON.stringify(trace)) })) };
const rows = r.widths.map(n => {
  const find = scenario => r.cases.find(c => c.width === n && c.scenario === scenario);
  return { n, reserved: find('miss').peakCommitted.handles, hit: find('hit').peakCharged.handles,
    miss: find('miss').peakCharged.handles,
    retained: find('failed-disposal').checkpoints.find(s => s.name === 'settled').committed.handles };
});
const x = n => 90 + (n - 8) / 24 * 660, y = n => 380 - n / 180 * 290;
const line = (key, color, dash = '') => `<polyline fill="none" stroke="${color}" stroke-width="3" ${dash ? 'stroke-dasharray="8 5"' : ''} points="${rows.map(r => `${x(r.n)},${y(r[key])}`).join(' ')}"/>`;
const dots = (key, color) => rows.map(r => `<circle cx="${x(r.n)}" cy="${y(r[key])}" r="4" fill="${color}"/><text x="${x(r.n) + 10}" y="${y(r[key]) - 7}" fill="${color}">${r[key]}</text>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540" viewBox="0 0 900 540" role="img" aria-labelledby="title desc">
<title id="title">RA-02 reservation pressure at widths 8, 16 and 32</title>
<desc id="desc">Synthetic model counters including execution exit. Reserved handle units are 42, 82, 162. Miss peaks are 26, 50, 98. Hit peaks are 10, 18, 34. Full cleanup overlap reaches the reservation line. Failed disposal retains 26, 50, 98 units after settlement.</desc>
<rect width="900" height="540" fill="#ffffff"/>
<g font-family="Arial, sans-serif" font-size="14" fill="#233047">
<text x="40" y="35" font-size="23" font-weight="bold">Reservation grows linearly; retention survives settlement</text>
<text x="40" y="60" fill="#526079">Synthetic RA-02 traces · logical handle units · execution exit included</text>
${[0, 40, 80, 120, 160].map(n => `<line x1="85" x2="790" y1="${y(n)}" y2="${y(n)}" stroke="#e2e7ee"/><text x="70" y="${y(n) + 5}" text-anchor="end">${n}</text>`).join('')}
${rows.map(r => `<text x="${x(r.n)}" y="408" text-anchor="middle">${r.n}</text>`).join('')}
<text x="420" y="434" text-anchor="middle">Admitted operations in one cohort</text>
${line('reserved', '#2256b3')}${line('miss', '#a35412')}${line('hit', '#167354')}
${dots('reserved', '#2256b3')}${dots('miss', '#a35412')}${dots('hit', '#167354')}
<text x="40" y="465" fill="#2256b3">● Reserved / full cleanup-overlap peak</text>
<text x="440" y="465" fill="#a35412">● Miss peak / failed-disposal retained total</text>
<text x="40" y="490" fill="#167354">● Hit peak</text>
<text x="40" y="520" fill="#526079">Reservation is capacity withheld; this chart does not measure memory footprint or host allocations.</text>
</g></svg>\n`;
for (const row of rows) assert.equal(row.miss, row.retained);
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'traces.json.gz'), archive);
fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(summary, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'pressure.svg'), svg);
console.log(JSON.stringify({ status: 'passed', cases: r.cases.length, widths: r.widths, rows, output }));
