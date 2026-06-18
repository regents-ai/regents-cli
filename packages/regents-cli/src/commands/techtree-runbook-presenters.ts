import type {
  RunbookAnswer,
  RunbookAnswerResponse,
  RunbookPaymentProfileResponse,
  RunbookQuestion,
  RunbookQuestionListResponse,
  RunbookQuestionResponse,
  RunbookUnlockResponse,
  RunbookVoteResponse,
} from "../internal-types/index.js";
import { CLI_PALETTE, renderKeyValuePanel, renderPanel, renderTablePanel, tone, type TableRow } from "../printer.js";

const label = (value: string | null | undefined): string =>
  value && value.trim().length > 0 ? value.replaceAll("_", " ") : "not listed";

const money = (value: string | null | undefined): string => (value ? `$${value}` : "not priced");

const shortId = (value: string): string => (value.length <= 16 ? value : `${value.slice(0, 10)}…${value.slice(-5)}`);

const shortAddress = (value: string): string =>
  value.length === 42 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;

const answerScore = (answer: RunbookAnswer): string => {
  const up = answer.upvote_count ?? 0;
  const down = answer.downvote_count ?? 0;
  if (up === 0 && down === 0) {
    return "no votes";
  }
  return `${up} up / ${down} down`;
};

const branchLine = (question: RunbookQuestion): string =>
  [
    question.problem.vendor,
    question.problem.product,
    question.tool,
    question.error_signature,
  ].map(label).join(" ⩛ ");

const nextCommandForQuestion = (question: RunbookQuestion): string => {
  const firstAnswer = question.answers[0];
  if (!firstAnswer) {
    return `regents techtree runbook answer post ${question.id} --summary @summary.md --price-usdc 0.25`;
  }

  if (question.status !== "solved") {
    return `regents techtree runbook mark-solved ${question.id} --answer-id ${firstAnswer.id}`;
  }

  return `regents techtree runbook unlock ${firstAnswer.id} --amount-usdc ${firstAnswer.price_usdc} --pay-to-address ${firstAnswer.payment_address}`;
};

const renderQuestionTree = (question: RunbookQuestion): string[] => {
  const answers =
    question.answers.length === 0
      ? ["      └─ no answers yet"]
      : question.answers.map((answer, index) => {
          const branch = index === question.answers.length - 1 ? "└─" : "├─";
          return `      ${branch} answer ${shortId(answer.id)} · ${label(answer.status)} · ${money(answer.price_usdc)} · ${answerScore(answer)}`;
        });

  return [
    `Runbook`,
    `└─ ${question.problem.vendor}`,
    `   └─ ${question.problem.product}`,
    `      └─ ${question.tool}`,
    `         ├─ ${question.error_signature}`,
    `         ├─ question ${shortId(question.id)} · ${label(question.status)}`,
    ...answers,
  ];
};

export const renderRunbookQuestionList = (response: RunbookQuestionListResponse): string => {
  const questions = response.data;
  if (questions.length === 0) {
    return renderPanel("◆ RUNBOOK QUESTIONS", [
      "No public Runbook reports matched this search.",
      "",
      "Tip: post one with `regents techtree runbook question post --help`.",
    ]);
  }

  const rows: TableRow[] = questions.map((question) => ({
    cells: [
      shortId(question.id),
      label(question.status),
      question.tool,
      question.error_signature,
      String(question.answers.length),
    ],
    colors: [
      CLI_PALETTE.secondary,
      question.status === "solved" ? CLI_PALETTE.emphasis : CLI_PALETTE.primary,
      CLI_PALETTE.accent,
      CLI_PALETTE.primary,
      CLI_PALETTE.secondary,
    ],
  }));

  return [
    renderTablePanel(
      "◆ RUNBOOK QUESTIONS",
      [
        { header: "question", minWidth: 15 },
        { header: "status", minWidth: 8 },
        { header: "tool", minWidth: 14 },
        { header: "problem", minWidth: 28 },
        { header: "answers", align: "right" },
      ],
      rows,
    ),
    renderPanel("◆ BRANCH TIP", [
      "Open a report to see the full path from vendor to answer.",
      "regents techtree runbook questions get <question-id>",
    ]),
  ].join("\n\n");
};

export const renderRunbookQuestion = (response: RunbookQuestionResponse): string => {
  const question = response.data;
  const answerRows: TableRow[] = question.answers.map((answer) => ({
    cells: [
      shortId(answer.id),
      label(answer.status),
      money(answer.price_usdc),
      answerScore(answer),
      label(answer.risk_level),
    ],
  }));

  return [
    renderPanel("◆ RUNBOOK BRANCH", renderQuestionTree(question), {
      borderColor: CLI_PALETTE.chrome,
      titleColor: CLI_PALETTE.title,
    }),
    renderKeyValuePanel("◆ QUESTION", [
      { label: "path", value: branchLine(question) },
      { label: "command", value: question.command },
      { label: "version", value: label(question.tool_version) },
      { label: "runtime", value: label(question.runtime) },
      { label: "docs", value: label(question.docs_followed_url ?? question.skill_followed_id) },
      { label: "status", value: label(question.status) },
    ]),
    answerRows.length > 0
      ? renderTablePanel(
          "◆ ANSWERS",
          [
            { header: "answer", minWidth: 15 },
            { header: "status", minWidth: 12 },
            { header: "price", align: "right" },
            { header: "buyer signal", minWidth: 16 },
            { header: "risk", minWidth: 14 },
          ],
          answerRows,
        )
      : renderPanel("◆ ANSWERS", [
          "No answers yet.",
          `Tip: ${nextCommandForQuestion(question)}`,
        ]),
    renderPanel("◆ NEXT MOVE", [
      nextCommandForQuestion(question),
      "Tip: buyers can vote after unlocking an answer.",
    ]),
  ].join("\n\n");
};

export const renderRunbookQuestionCreated = (response: RunbookQuestionResponse): string => {
  const question = response.data;
  return [
    renderKeyValuePanel("◆ RUNBOOK QUESTION POSTED", [
      { label: "question", value: question.id },
      { label: "branch", value: branchLine(question) },
      { label: "status", value: label(question.status) },
      { label: "page", value: `/runbook/questions/${question.id}` },
    ]),
    renderPanel("◆ NEXT MOVE", [
      `regents techtree runbook questions get ${question.id}`,
      "post an answer or watch the branch for updates",
    ]),
  ].join("\n\n");
};

export const renderRunbookAnswer = (response: RunbookAnswerResponse): string => {
  const answer = response.data;
  return renderKeyValuePanel("◆ RUNBOOK ANSWER", [
    { label: "answer", value: answer.id },
    { label: "question", value: answer.question_id },
    { label: "status", value: label(answer.status) },
    { label: "price", value: money(answer.price_usdc) },
    { label: "public unlock", value: money(answer.public_unlock_price_usdc) },
    { label: "payment", value: shortAddress(answer.payment_address) },
    { label: "next", value: `regents techtree runbook questions get ${answer.question_id}` },
  ]);
};

export const renderRunbookPaymentProfile = (response: RunbookPaymentProfileResponse): string =>
  renderKeyValuePanel("◆ RUNBOOK PAYMENT ADDRESS", [
    { label: "agent", value: String(response.data.agent_identity_id) },
    { label: "payment", value: shortAddress(response.data.payment_address) },
    { label: "next", value: "post or price a Runbook answer" },
  ]);

export const renderRunbookUnlock = (response: RunbookUnlockResponse): string =>
  renderPanel("◆ RUNBOOK UNLOCK RECORDED", [
    "The unlock record is saved.",
    `Tip: vote with regents techtree runbook answer vote ${(response.data.answer_id as string | undefined) ?? "<answer-id>"} --vote up`,
  ]);

export const renderRunbookVote = (_response: RunbookVoteResponse): string =>
  renderPanel("◆ RUNBOOK VOTE RECORDED", [
    tone("Buyer signal updated.", CLI_PALETTE.accent, true),
    "Open the question again to inspect the answer score.",
  ]);


export const renderRunbookSolved = (response: Record<string, unknown>): string => {
  const question = response.question as RunbookQuestion | undefined;
  const answer = response.answer as RunbookAnswer | undefined;
  return renderKeyValuePanel("◆ RUNBOOK SOLVED", [
    { label: "question", value: question?.id ?? "unknown" },
    { label: "answer", value: answer?.id ?? "unknown" },
    { label: "next", value: question ? `regents techtree runbook questions get ${question.id}` : "open the question" },
  ]);
};
