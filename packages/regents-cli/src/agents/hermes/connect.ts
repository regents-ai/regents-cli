import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { expandHome } from "../../internal-runtime/index.js";
import { renderHermesRegentsWorkSkill } from "./skill-template.js";

export interface WriteHermesConnectorInput {
  readonly regentId: string;
  readonly workerId: string;
  readonly workerName: string;
  readonly pluginPath?: string;
  readonly skillPath?: string;
}

export interface WriteHermesConnectorResult {
  readonly pluginPath: string;
  readonly skillPath: string;
}

export const defaultHermesPluginPath = (): string =>
  path.join(process.env.HOME ?? process.env.USERPROFILE ?? "~", ".hermes", "plugins", "regents-work", "plugin.yaml");

export const defaultHermesSkillPath = (): string =>
  path.join(process.env.HOME ?? process.env.USERPROFILE ?? "~", ".hermes", "skills", "regents-work", "SKILL.md");

const renderHermesRegentsWorkPlugin = (input: WriteHermesConnectorInput): string => `name: regents-work
version: 1.0.0
description: Local Regent regent work bridge for Hermes
metadata:
  regent_id: ${JSON.stringify(input.regentId)}
  worker_id: ${JSON.stringify(input.workerId)}
  worker_name: ${JSON.stringify(input.workerName)}
  local_bridge:
    command: regents
    args:
      - work
      - local-loop
      - --regent-id
      - ${JSON.stringify(input.regentId)}
      - --worker-id
      - ${JSON.stringify(input.workerId)}
`;

export const writeHermesRegentsWorkConnector = async (
  input: WriteHermesConnectorInput,
): Promise<WriteHermesConnectorResult> => {
  const pluginPath = path.resolve(expandHome(input.pluginPath ?? defaultHermesPluginPath()));
  const skillPath = path.resolve(expandHome(input.skillPath ?? defaultHermesSkillPath()));

  await mkdir(path.dirname(pluginPath), { recursive: true });
  await mkdir(path.dirname(skillPath), { recursive: true });
  await writeFile(pluginPath, renderHermesRegentsWorkPlugin(input), "utf8");
  await writeFile(
    skillPath,
    renderHermesRegentsWorkSkill({
      regentId: input.regentId,
      workerId: input.workerId,
      workerName: input.workerName,
    }),
    "utf8",
  );

  return { pluginPath, skillPath };
};
