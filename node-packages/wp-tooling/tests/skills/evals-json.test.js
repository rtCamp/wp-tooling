/**
 * Schema validation for every skill's evals/evals.json.
 *
 * Catches edits that would break the upstream skill-creator runner. The
 * runner expects the schema documented at:
 *   https://github.com/anthropics/skills/blob/main/skills/skill-creator/references/schemas.md
 *
 * SKILL.md structure (frontmatter, headings, link resolution) is not
 * validated here — those rarely break in practice and PR review catches
 * them. The evals.json shape is the one that needs guarding because its
 * failure mode is silent: the upstream runner errors at run time, not
 * at edit time.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '..', '..', '..', '..', 'skills');

function findSkillDirs() {
	if (!fs.existsSync(SKILLS_DIR)) {
		return [];
	}
	return (
		fs
			.readdirSync(SKILLS_DIR, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			// Skip skill-creator workspace directories (skills/<name>-workspace/)
			// — they're local eval scratch, gitignored, not actual skills.
			.filter((name) => !name.endsWith('-workspace'))
			.sort()
	);
}

const SKILL_DIRS = findSkillDirs();

describe.each(SKILL_DIRS)('skills/%s/evals/evals.json', (skillName) => {
	const evalsPath = path.join(SKILLS_DIR, skillName, 'evals', 'evals.json');

	test('file exists', () => {
		expect(fs.existsSync(evalsPath)).toBe(true);
	});

	test('parses as JSON', () => {
		const raw = fs.readFileSync(evalsPath, 'utf8');
		expect(() => JSON.parse(raw)).not.toThrow();
	});

	test('skill_name matches the directory name', () => {
		const data = JSON.parse(fs.readFileSync(evalsPath, 'utf8'));
		expect(data.skill_name).toBe(skillName);
	});

	test('evals[] is a non-empty array', () => {
		const data = JSON.parse(fs.readFileSync(evalsPath, 'utf8'));
		expect(Array.isArray(data.evals)).toBe(true);
		expect(data.evals.length).toBeGreaterThan(0);
	});

	test('each eval has id, prompt, expected_output, files, expectations', () => {
		const data = JSON.parse(fs.readFileSync(evalsPath, 'utf8'));
		for (const e of data.evals) {
			expect(typeof e.id).toBe('number');
			expect(typeof e.prompt).toBe('string');
			expect(e.prompt.length).toBeGreaterThan(0);
			expect(typeof e.expected_output).toBe('string');
			expect(Array.isArray(e.files)).toBe(true);
			expect(Array.isArray(e.expectations)).toBe(true);
			expect(e.expectations.length).toBeGreaterThan(0);
			for (const ex of e.expectations) {
				expect(typeof ex).toBe('string');
				expect(ex.length).toBeGreaterThan(0);
			}
		}
	});

	test('eval ids are unique within the skill', () => {
		const data = JSON.parse(fs.readFileSync(evalsPath, 'utf8'));
		const ids = data.evals.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
