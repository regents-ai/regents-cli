import type { DoctorCheckResult } from "../../internal-types/index.js";

const CHECK_PRIORITY = {
    "runtime.config.load": 0,
    "runtime.wallet.source": 1,
    "auth.identity.headers": 2,
    "auth.session.present": 3,
    "auth.session.freshness": 4,
    "auth.session.binding": 5,
    "auth.http-envelope.build": 6,
    "techtree.health": 7,
    "techtree.public.read": 8,
    "techtree.authenticated.probe": 9,
    "artifact.core.dir": 10,
    "artifact.uv.available": 11,
    "bbh.leaderboard.read": 12,
    "bbh.workspace.root": 13,
    "full.preconditions": 14,
    "full.node.create": 15,
    "full.comment.add": 16,
    "full.comment.readback": 17,
} as const satisfies Record<string, number>;
const STATUS_PRIORITY = {
    fail: 0,
    warn: 1,
    skip: 2,
    ok: 3,
} as const;

export function deriveNextSteps(checks: DoctorCheckResult[]): string[] {
    const nextSteps = new Set<string>();
    const actionableChecks = [...checks]
        .filter((check) => check.status !== "ok" && check.remediation)
        .sort((left, right) => {
        const byStatus = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
        if (byStatus !== 0) {
            return byStatus;
        }
        const leftPriority = CHECK_PRIORITY[left.id as keyof typeof CHECK_PRIORITY] ?? Number.MAX_SAFE_INTEGER;
        const rightPriority = CHECK_PRIORITY[right.id as keyof typeof CHECK_PRIORITY] ?? Number.MAX_SAFE_INTEGER;
        if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority;
        }
        return left.id.localeCompare(right.id);
    });
    for (const check of actionableChecks) {
        if (!check.remediation) {
            continue;
        }
        nextSteps.add(check.remediation);
    }
    return [...nextSteps];
}
