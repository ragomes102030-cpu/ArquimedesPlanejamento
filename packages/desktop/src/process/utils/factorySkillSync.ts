import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { copyDirectoryRecursively } from './utils';

type FactorySkillManifest = {
  version: 1;
  skills: Record<string, string>;
};

type SyncOptions = {
  legacyManagedHashes?: Record<string, string>;
};

export type FactorySkillSyncResult = {
  installed: number;
  updated: number;
  preserved: number;
  preservedSkills: string[];
};

const MANIFEST_NAME = '.arquimedes-factory-skills.json';

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function hashSkillDirectory(root: string): Promise<string> {
  const files: string[] = [];

  const collect = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const subdirectories: string[] = [];
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        subdirectories.push(absolutePath);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolutePath).split(path.sep).join('/'));
      } else {
        throw new Error(`Unsupported file type in factory skill: ${absolutePath}`);
      }
    }
    await Promise.all(subdirectories.map(collect));
  };

  await collect(root);
  files.sort();

  const hash = createHash('sha256');
  const contents = await Promise.all(
    files.map((relativePath) => fs.readFile(path.join(root, ...relativePath.split('/'))))
  );
  files.forEach((relativePath, index) => {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(contents[index]);
    hash.update('\0');
  });
  return hash.digest('hex');
}

async function readManifest(filePath: string): Promise<FactorySkillManifest> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('skills' in parsed) ||
      typeof parsed.skills !== 'object' ||
      parsed.skills === null ||
      Object.values(parsed.skills).some((hash) => typeof hash !== 'string')
    ) {
      throw new Error('Invalid Arquimedes factory skill manifest');
    }
    return { version: 1, skills: parsed.skills as Record<string, string> };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, skills: {} };
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && error.message === 'Invalid Arquimedes factory skill manifest')
    ) {
      const backupPath = `${filePath}.corrupt-${Date.now()}`;
      await fs.rename(filePath, backupPath);
      console.warn(`[Arquimedes] invalid factory skill manifest preserved at ${backupPath}`);
      return { version: 1, skills: {} };
    }
    throw error;
  }
}

async function replaceDirectory(source: string, destination: string): Promise<void> {
  const parent = path.dirname(destination);
  const staged = path.join(parent, `.${path.basename(destination)}.stage-${randomUUID()}`);
  const backup = path.join(parent, `.${path.basename(destination)}.backup-${randomUUID()}`);
  try {
    await copyDirectoryRecursively(source, staged);
    await fs.rename(destination, backup);
  } catch (error) {
    await fs.rm(staged, { recursive: true, force: true });
    throw error;
  }
  try {
    await fs.rename(staged, destination);
  } catch (error) {
    await fs.rename(backup, destination);
    await fs.rm(staged, { recursive: true, force: true });
    throw error;
  }
  await fs.rm(backup, { recursive: true, force: true });
}

async function writeManifest(filePath: string, manifest: FactorySkillManifest): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

/**
 * Seeds new factory skills and updates tracked copies only when their contents
 * still match the last bundled version. Untracked or edited skills are kept.
 */
export async function syncFactorySkills(
  factorySkillDirs: readonly string[],
  userSkillsDir: string,
  options: SyncOptions = {}
): Promise<FactorySkillSyncResult> {
  await fs.mkdir(userSkillsDir, { recursive: true });
  const manifestPath = path.join(userSkillsDir, MANIFEST_NAME);
  const manifest = await readManifest(manifestPath);
  const result: FactorySkillSyncResult = { installed: 0, updated: 0, preserved: 0, preservedSkills: [] };
  let manifestChanged = false;

  // Serialize writes because flattened skill names can collide and the manifest is shared.
  /* eslint-disable no-await-in-loop -- skill directory updates must be collision-safe */
  for (const source of factorySkillDirs) {
    const name = path.basename(source);
    const destination = path.join(userSkillsDir, name);
    if (!(await exists(destination))) {
      await copyDirectoryRecursively(source, destination);
      manifest.skills[name] = await hashSkillDirectory(source);
      manifestChanged = true;
      result.installed += 1;
      continue;
    }

    const previousHash = manifest.skills[name] ?? options.legacyManagedHashes?.[name];
    if (!previousHash) continue;

    const destinationHash = await hashSkillDirectory(destination);
    const sourceHash = await hashSkillDirectory(source);
    if (destinationHash === sourceHash) {
      if (manifest.skills[name] !== sourceHash) {
        manifest.skills[name] = sourceHash;
        manifestChanged = true;
      }
      continue;
    }
    if (destinationHash !== previousHash) {
      result.preserved += 1;
      result.preservedSkills.push(name);
      continue;
    }

    await replaceDirectory(source, destination);
    manifest.skills[name] = sourceHash;
    manifestChanged = true;
    result.updated += 1;
  }
  /* eslint-enable no-await-in-loop */

  if (manifestChanged) await writeManifest(manifestPath, manifest);
  return result;
}
