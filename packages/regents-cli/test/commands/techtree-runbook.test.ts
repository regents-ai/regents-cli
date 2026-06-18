import { describe, expect, it } from "vitest";

import {
  renderRunbookQuestion,
  renderRunbookQuestionList,
} from "../../src/commands/techtree-runbook-presenters.js";
import type { RunbookQuestion } from "../../src/internal-types/index.js";

const question = (overrides: Partial<RunbookQuestion> = {}): RunbookQuestion => ({
  id: "rbq_1234567890abcdef1234",
  problem_id: "rbp_1234567890abcdef12345678",
  problem: {
    id: "rbp_1234567890abcdef12345678",
    vendor: "Shopify",
    product: "Shopify CLI",
    tool: "shopify-cli",
    command: "shopify app dev",
    error_signature: "Auth loop after app dev",
    skill_followed_id: null,
    docs_followed_url: "https://shopify.dev/docs/api/shopify-cli",
    status: "open",
    question_count: 1,
    solved_answer_id: null,
    updated_at: null,
  },
  asker_agent_id: 1,
  tool: "shopify-cli",
  tool_version: "3.91.0",
  runtime: "codex",
  command: "shopify app dev",
  error_signature: "Auth loop after app dev",
  docs_followed_url: "https://shopify.dev/docs/api/shopify-cli",
  skill_followed_id: null,
  redacted_log_bundle: {},
  environment: {},
  failed_attempts: [],
  root_cause_category: null,
  status: "answered",
  solved_answer_id: null,
  public_visibility: "public",
  answers: [
    {
      id: "rba_1234567890abcdef1234",
      question_id: "rbq_1234567890abcdef1234",
      problem_id: "rbp_1234567890abcdef12345678",
      solver_agent_id: 2,
      public_summary: "Refresh the local session before starting the development command.",
      root_cause_category: "stale session",
      risk_level: "local_write",
      applicability: {},
      status: "candidate",
      price_usdc: "0.25",
      public_unlock_price_usdc: "25.00",
      payment_address: "0x0000000000000000000000000000000000000002",
      revenue_split: {},
      unlock_count: 3,
      upvote_count: 2,
      downvote_count: 1,
      inserted_at: null,
      updated_at: null,
    },
  ],
  inserted_at: null,
  updated_at: null,
  ...overrides,
});

describe("Runbook terminal presenters", () => {
  it("renders a question list as a navigable table", () => {
    const output = renderRunbookQuestionList({ data: [question()] });

    expect(output).toContain("RUNBOOK QUESTIONS");
    expect(output).toContain("shopify-cli");
    expect(output).toContain("regents techtree runbook questions get <question-id>");
  });

  it("renders a question as a branch tree with answer signals", () => {
    const output = renderRunbookQuestion({ data: question() });

    expect(output).toContain("RUNBOOK BRANCH");
    expect(output).toContain("Shopify");
    expect(output).toContain("Shopify CLI");
    expect(output).toContain("2 up / 1 down");
    expect(output).toContain("regents techtree runbook mark-solved");
  });
});
