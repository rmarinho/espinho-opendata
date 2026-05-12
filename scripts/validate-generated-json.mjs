import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertValidUpdateSchema } from './update-schema.mjs';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'public', 'data');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

async function validate() {
  const latestPath = path.join(DATA_DIR, 'latest.json');
  const latest = await readJson(latestPath);
  assertValidUpdateSchema(latest);

  const archivePath = path.join(ARCHIVE_DIR, `${latest.date}.json`);
  const archiveEntry = await readJson(archivePath);
  assertValidUpdateSchema(archiveEntry);

  const indexPath = path.join(ARCHIVE_DIR, 'index.json');
  const index = await readJson(indexPath);
  if (!Array.isArray(index)) {
    throw new Error('Archive index must be an array of date strings.');
  }

  process.stdout.write(`Schema validation passed for latest and archive entry ${latest.date}.\n`);
}

validate().catch((error) => {
  process.stderr.write(`Schema validation failed: ${error.message}\n`);
  process.exitCode = 1;
});
