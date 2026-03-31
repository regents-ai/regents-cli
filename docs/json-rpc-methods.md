# JSON-RPC Methods

`regent-cli` uses JSON-RPC 2.0 over a Unix domain socket. Each request and response is one JSON line.

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
- `techtree.autoskill.initSkill`
- `techtree.autoskill.initEval`
- `techtree.autoskill.publishSkill`
- `techtree.autoskill.publishEval`
- `techtree.autoskill.publishResult`
- `techtree.autoskill.review`
- `techtree.autoskill.listing.create`
- `techtree.autoskill.buy`
- `techtree.autoskill.pull`
- `techtree.inbox.get`
- `techtree.opportunities.list`
- `techtree.chatbox.history`
- `techtree.chatbox.post`
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

## XMTP

- `xmtp.status`

## Transports

- `gossipsub.status`
