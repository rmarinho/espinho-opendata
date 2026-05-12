import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertValidUpdateSchema } from './update-schema.mjs';

const ROOT = process.cwd();

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

function assertSameJson(left, right, message) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(message);
  }
}

function assertExpectedDate(payload, expectedDate, label) {
  if (expectedDate && payload.date !== expectedDate) {
    throw new Error(`${label}.date must match expected run date ${expectedDate}; got ${payload.date}.`);
  }
}

export async function validateGeneratedJson({ rootDir = ROOT, expectedDate = process.env.EXPECTED_UPDATE_DATE } = {}) {
  const dataDir = path.join(rootDir, 'public', 'data');
  const archiveDir = path.join(dataDir, 'archive');
  const latestPath = path.join(dataDir, 'latest.json');
  const latest = await readJson(latestPath);
  assertValidUpdateSchema(latest);
  assertExpectedDate(latest, expectedDate, 'latest.json');

  const archiveDate = expectedDate || latest.date;
  const archivePath = path.join(archiveDir, `${archiveDate}.json`);
  const archiveEntry = await readJson(archivePath);
  assertValidUpdateSchema(archiveEntry);
  assertExpectedDate(archiveEntry, expectedDate, `${archiveDate}.json`);
  assertSameJson(latest, archiveEntry, `Archive entry ${archiveDate}.json must match latest.json.`);

  const indexPath = path.join(archiveDir, 'index.json');
  const index = await readJson(indexPath);
  if (!Array.isArray(index)) {
    throw new Error('Archive index must be an array of date strings.');
  }

  if (!index.includes(archiveDate)) {
    throw new Error(`Archive index must include ${archiveDate}.`);
  }

  if (expectedDate && index[0] !== expectedDate) {
    throw new Error(`Archive index must put expected run date ${expectedDate} first; got ${index[0]}.`);
  }

  process.stdout.write(`Schema validation passed for latest and archive entry ${latest.date}.\n`);
}

const directExecutionTarget = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === directExecutionTarget) {
  validateGeneratedJson().catch((error) => {
    process.stderr.write(`Schema validation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
