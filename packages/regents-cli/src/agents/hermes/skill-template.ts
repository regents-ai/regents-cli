export interface HermesSkillTemplateInput {
  readonly regentId: string;
  readonly workerId: string;
  readonly workerName: string;
}

export const renderHermesRegentsWorkSkill = (input: HermesSkillTemplateInput): string => `---
name: regents-work
description: Use Regents CLI to receive, run, and update Regent work from a local Hermes worker.
---

# Regents Work

Use this skill when a person asks Hermes to help with Regent work.

## Safety

Do not upload secrets, private memory, inbox content, calendar content, chat content, wallet material, keys, tokens, session files, or private regent files unless the person explicitly asks for that exact content to be used.

When work needs private material, ask which exact files or messages may be used before reading or sending them.

## Regent

- Regent id: ${input.regentId}
- Worker id: ${input.workerId}
- Worker name: ${input.workerName}

## Commands

- Check available work: \`regents work local-loop --regent-id ${input.regentId} --worker-id ${input.workerId} --once\`
- Check a run: \`regents work watch <run_id> --regent-id ${input.regentId}\`
- List assignable workers: \`regents agent execution-pool --regent-id ${input.regentId} --manager ${input.workerId}\`

Keep updates short and specific. Only attach files that the person approved for this run.
`;
