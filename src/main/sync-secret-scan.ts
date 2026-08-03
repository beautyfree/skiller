export type SyncSecretFinding = {
	rule: "private-key" | "github-token" | "provider-token" | "aws-access-key" | "connection-string" | "credential-assignment";
	line: number;
	column: number;
};

type Rule = {
	id: SyncSecretFinding["rule"];
	pattern: RegExp;
};

const rules: Rule[] = [
	{ id: "private-key", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g },
	{ id: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
	{ id: "provider-token", pattern: /\b(?:sk-ant-|sk-(?:proj-)?)[A-Za-z0-9_-]{20,}\b/g },
	{ id: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
	{ id: "connection-string", pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^/\s@]+@/gi },
];

/** A connection string in an explicitly labelled documentation example is not
 * a credential to publish. Real connection strings still remain a hard stop. */
function isDocumentedConnectionExample(line: string): boolean {
	return /(?:\b(?:placeholder|sample|replace(?:\s+me)?|your[_ -]?(?:database|password|url|credential)|real values?)\b|\be\.g\.)/i.test(line);
}

/**
 * Finds likely credentials without returning their values. Callers can show a
 * file name plus line/column, while keeping the candidate secret out of logs.
 */
export function scanTextForSecrets(text: string): SyncSecretFinding[] {
	const findings: SyncSecretFinding[] = [];
	const lines = text.split(/\r?\n/);
	for (const [lineIndex, line] of lines.entries()) {
		for (const rule of rules) {
			rule.pattern.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = rule.pattern.exec(line)) !== null) {
				if (rule.id === "connection-string" && isDocumentedConnectionExample(line)) continue;
				findings.push({ rule: rule.id, line: lineIndex + 1, column: match.index + 1 });
			}
		}
	}
	return findings;
}
