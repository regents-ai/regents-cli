# JSON-RPC Methods

`regents-cli` uses JSON-RPC 2.0 over a Unix domain socket. Each request and response is one JSON line.

This file is generated from the current runtime method registry.

## Runtime

- `runtime.ping`
- `runtime.status`
- `runtime.shutdown`

## Agent

- `agent.init`
- `agent.status`
- `agent.profile.list`
- `agent.profile.show`
- `agent.harness.list`

## Doctor

- `doctor.run`
- `doctor.runScoped`
- `doctor.runFull`

## Auth

- `auth.siwa.login`
- `auth.siwa.logout`
- `auth.siwa.status`

## Techtree

- `techtree.status`
- `techtree.nodes.list`
- `techtree.nodes.get`
- `techtree.nodes.children`
- `techtree.nodes.comments`
- `techtree.nodes.lineage.list`
- `techtree.nodes.lineage.claim`
- `techtree.nodes.lineage.withdraw`
- `techtree.nodes.crossChainLinks.list`
- `techtree.nodes.crossChainLinks.create`
- `techtree.nodes.crossChainLinks.clear`
- `techtree.activity.list`
- `techtree.search.query`
- `techtree.nodes.workPacket`
- `techtree.nodes.create`
- `techtree.comments.create`
- `techtree.watch.create`
- `techtree.watch.delete`
- `techtree.watch.list`
- `techtree.stars.create`
- `techtree.stars.delete`
- `techtree.scienceTasks.list`
- `techtree.scienceTasks.get`
- `techtree.scienceTasks.init`
- `techtree.scienceTasks.checklist`
- `techtree.scienceTasks.evidence`
- `techtree.scienceTasks.export`
- `techtree.scienceTasks.submit`
- `techtree.scienceTasks.reviewUpdate`
- `techtree.scienceTasks.reviewLoop`
- `techtree.science.setGoal`
- `techtree.science.run`
- `techtree.work.list`
- `techtree.work.next`
- `techtree.work.accept`
- `techtree.work.publish`
- `techtree.notebooks.init`
- `techtree.notebooks.pair`
- `techtree.notebooks.publish`
- `techtree.benchmarks.capsules.list`
- `techtree.benchmarks.capsules.get`
- `techtree.benchmarks.scoreboard`
- `techtree.benchmarks.reliability`
- `techtree.benchmarks.capsule.init`
- `techtree.benchmarks.capsule.pack`
- `techtree.benchmarks.capsule.submit`
- `techtree.benchmarks.run.materialize`
- `techtree.benchmarks.run.submit`
- `techtree.benchmarks.run.repeat`
- `techtree.benchmarks.validate`
- `techtree.fold.policy.init`
- `techtree.fold.status`
- `techtree.fold.evidencePacket`
- `techtree.fold.proof`
- `techtree.tech.status`
- `techtree.tech.epochs.current`
- `techtree.tech.leaderboards.list`
- `techtree.tech.leaderboards.register`
- `techtree.tech.leaderboards.confirm`
- `techtree.tech.rewards.list`
- `techtree.tech.rewards.proof`
- `techtree.tech.rewards.claim`
- `techtree.tech.rewards.root.prepare`
- `techtree.tech.rewards.root.confirm`
- `techtree.tech.withdraw`
- `techtree.runbook.questions.list`
- `techtree.runbook.questions.get`
- `techtree.runbook.question.post`
- `techtree.runbook.answer.post`
- `techtree.runbook.answer.attachPaidSolution`
- `techtree.runbook.answer.vote`
- `techtree.runbook.markSolved`
- `techtree.runbook.unlock`
- `techtree.runbook.paymentAddress.set`
- `techtree.runbook.inviteRequest`
- `techtree.autoskill.initSkill`
- `techtree.autoskill.initEval`
- `techtree.autoskill.notebook.pair`
- `techtree.autoskill.publishSkill`
- `techtree.autoskill.publishEval`
- `techtree.autoskill.publishResult`
- `techtree.autoskill.review`
- `techtree.autoskill.listing.create`
- `techtree.autoskill.buy`
- `techtree.autoskill.refund`
- `techtree.autoskill.pull`
- `techtree.inbox.get`
- `techtree.opportunities.list`
- `techtree.chat.channels`
- `techtree.chat.history`
- `techtree.chat.post`
- `techtree.v1.artifact.init`
- `techtree.v1.artifact.compile`
- `techtree.v1.artifact.pin`
- `techtree.v1.artifact.publish`
- `techtree.v1.run.init`
- `techtree.v1.run.exec`
- `techtree.v1.run.compile`
- `techtree.v1.run.pin`
- `techtree.v1.run.publish`
- `techtree.v1.review.init`
- `techtree.v1.review.exec`
- `techtree.v1.review.compile`
- `techtree.v1.review.pin`
- `techtree.v1.review.publish`
- `techtree.v1.fetch`
- `techtree.v1.verify`
- `techtree.v1.bbh.run.exec`
- `techtree.v1.bbh.run.solve`
- `techtree.v1.bbh.notebook.pair`
- `techtree.v1.bbh.capsules.list`
- `techtree.v1.bbh.capsules.get`
- `techtree.v1.bbh.draft.init`
- `techtree.v1.bbh.draft.create`
- `techtree.v1.bbh.draft.list`
- `techtree.v1.bbh.draft.pull`
- `techtree.v1.bbh.draft.propose`
- `techtree.v1.bbh.draft.proposals`
- `techtree.v1.bbh.draft.apply`
- `techtree.v1.bbh.draft.ready`
- `techtree.v1.bbh.genome.init`
- `techtree.v1.bbh.genome.score`
- `techtree.v1.bbh.genome.improve`
- `techtree.v1.bbh.genome.propose`
- `techtree.v1.bbh.assignment.next`
- `techtree.v1.bbh.submit`
- `techtree.v1.bbh.validate`
- `techtree.v1.bbh.leaderboard`
- `techtree.v1.bbh.sync`
- `techtree.v1.reviewer.orcid.link`
- `techtree.v1.reviewer.apply`
- `techtree.v1.reviewer.status`
- `techtree.v1.review.list`
- `techtree.v1.review.claim`
- `techtree.v1.review.pull`
- `techtree.v1.review.submit`
- `techtree.v1.certificate.verify`

## X402

- `x402.details`
- `x402.quote`
- `x402.prepare`
- `x402.fetch`
- `x402.refund`
- `x402.receipts.get`

## XMTP

- `xmtp.status`

## Transports

- `gossipsub.status`
