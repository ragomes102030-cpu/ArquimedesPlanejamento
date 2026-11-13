import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyDirectoryRecursively } from '@process/utils/utils';
import { hashSkillDirectory, syncFactorySkills } from '@process/utils/factorySkillSync';

async function createSkill(rootDir: string, name: string, content: string): Promise<string> {
  const skillDir = path.join(rootDir, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf8');
  return skillDir;
}

describe('syncFactorySkills', () => {
  let root: string;
  let factoryRoot: string;
  let userSkillsDir: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'arquimedes-factory-skills-'));
    factoryRoot = path.join(root, 'factory');
    userSkillsDir = path.join(root, 'user-skills');
    await mkdir(factoryRoot);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('installs new skills and records their factory version for later updates', async () => {
    const source = await createSkill(factoryRoot, 'field-specialist', 'factory v1');

    await expect(syncFactorySkills([source], userSkillsDir)).resolves.toMatchObject({ installed: 1 });
    await expect(readFile(path.join(userSkillsDir, 'field-specialist', 'SKILL.md'), 'utf8')).resolves.toBe(
      'factory v1'
    );

    await writeFile(path.join(source, 'SKILL.md'), 'factory v2', 'utf8');
    await expect(syncFactorySkills([source], userSkillsDir)).resolves.toMatchObject({ updated: 1 });
    await expect(readFile(path.join(userSkillsDir, 'field-specialist', 'SKILL.md'), 'utf8')).resolves.toBe(
      'factory v2'
    );
    await expect(syncFactorySkills([source], userSkillsDir)).resolves.toMatchObject({
      installed: 0,
      updated: 0,
      preserved: 0,
      preservedSkills: [],
    });
  });

  it('migrates a known legacy factory skill that has no sync manifest yet', async () => {
    const source = await createSkill(factoryRoot, 'civil-tutor', 'factory legacy');
    const legacyHash = await hashSkillDirectory(source);
    await copyDirectoryRecursively(source, path.join(userSkillsDir, 'civil-tutor'));
    await writeFile(path.join(source, 'SKILL.md'), 'factory current', 'utf8');

    await expect(
      syncFactorySkills([source], userSkillsDir, { legacyManagedHashes: { 'civil-tutor': legacyHash } })
    ).resolves.toMatchObject({ updated: 1 });
    await expect(readFile(path.join(userSkillsDir, 'civil-tutor', 'SKILL.md'), 'utf8')).resolves.toBe(
      'factory current'
    );
  });

  it('preserves customized skills instead of replacing user edits', async () => {
    const source = await createSkill(factoryRoot, 'civil-tutor', 'factory v1');
    await syncFactorySkills([source], userSkillsDir);
    await writeFile(path.join(userSkillsDir, 'civil-tutor', 'SKILL.md'), 'user customization', 'utf8');
    await writeFile(path.join(source, 'SKILL.md'), 'factory v2', 'utf8');

    await expect(syncFactorySkills([source], userSkillsDir)).resolves.toMatchObject({
      preserved: 1,
      preservedSkills: ['civil-tutor'],
    });
    await expect(readFile(path.join(userSkillsDir, 'civil-tutor', 'SKILL.md'), 'utf8')).resolves.toBe(
      'user customization'
    );
  });

  it('backs up a corrupt manifest and continues installing new skills', async () => {
    const source = await createSkill(factoryRoot, 'field-specialist', 'factory v1');
    await mkdir(userSkillsDir, { recursive: true });
    await writeFile(path.join(userSkillsDir, '.arquimedes-factory-skills.json'), '{broken', 'utf8');

    await expect(syncFactorySkills([source], userSkillsDir)).resolves.toMatchObject({ installed: 1 });
    await expect(readdir(userSkillsDir)).resolves.toEqual(
      expect.arrayContaining(['.arquimedes-factory-skills.json', 'field-specialist'])
    );
    const manifest = JSON.parse(await readFile(path.join(userSkillsDir, '.arquimedes-factory-skills.json'), 'utf8'));
    expect(manifest.version).toBe(1);
  });
});
