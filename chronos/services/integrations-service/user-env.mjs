import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { servicesData } from '../paths.mjs';

const directory = path.join(servicesData, 'integrations-service');
const file = path.join(directory, 'keys.env');

// Each NAME="value" line uses JSON string escaping. Never source the file in a shell.
export function readEnvFile() {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  const values = Object.create(null);
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const entry = /^([A-Z0-9_]+)=(.+)$/.exec(line);
    try {
      if (!entry || typeof (values[entry[1]] = JSON.parse(entry[2])) !== 'string') throw Error();
    } catch { throw Error('Не удалось прочитать файл API-ключей'); }
  }
  return values;
}

export function writeEnvValue(name, value) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const values = readEnvFile();
  if (value == null) delete values[name]; else values[name] = value;
  const tmp = file + '.' + randomUUID();
  try {
    const content = Object.entries(values).map(([k,v]) => k + '=' + JSON.stringify(v) + '\n').join('');
    fs.writeFileSync(tmp, content, { flag: 'wx', mode: 0o600, flush: true });
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
}
