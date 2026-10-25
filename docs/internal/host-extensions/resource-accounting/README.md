# HEX-RA: shared resource ownership and accounting

This workstream follows the [ownership](../ownership/README.md) and
[bounded composition](../composition/README.md) investigations. Its first proposed
milestone is cache, core fetch and their fixed composition under one accounting
contract. No new scheduler, automatic retry, silent fallback or universal cost
optimizer is proposed. The owner approved RA-00 through RA-07; later units remain planned.

| Unit | Deliverable | Recommended model / reasoning effort | Status |
| --- | --- | --- | --- |
| [RA-00](ra00/README.md) | Ownership inventory and evidence | GPT-6.1 Sol / High | Complete; evidence only |
| [RA-01](ra01/README.md) | Shared ownership/disposition contract | Astra / High | Complete; internal candidate and checked lifecycle traces |
| [RA-02](ra02/README.md) | Admission, reservation and refund policy | Astra / High | Complete; candidate policy and [8/16/32 reservation sweep](ra02/sweep/README.md); review checkpoint |
| [RA-03](ra03/README.md) | Minimal shared accounting service prototype | GPT-6.1 Sol / High | Complete; bounded JS prototype plus [Native fixed-profile proof](ra03/native/README.md), executor hooks and measured costs; production integration remains separate |
| [RA-04](ra04/README.md) | Exclusive lease and in-flight buffer pressure | Astra / High | Complete; compiled Native pin guard, ledger pressure and copy-overlap evidence; provider integration remains separate |
| [RA-05](ra05/README.md) | Core fetch integration | Astra / High | Complete bounded checkpoint; Native driver integration and JS ownership checks; production adoption/host qualification remain separate |
| [RA-06](ra06/README.md) | Cache integration | GPT-6.1 Sol / High | Complete bounded checkpoint; Native cache ownership, whole-cohort reservation and shared lifecycle hooks; production adoption/host qualification remain separate |
| [RA-07](ra07/README.md) | Composed-operation integration | Astra / High | Complete bounded checkpoint; joint Native cache/fetch accounting, fixed child lifecycle and whole-cohort admission; review before diagnostics/adoption |
| RA-08 | Capability/resource evidence and diagnostics | GPT-6.1 Sol / High | Planned |
| RA-09 | Matched cost and unused-path measurements | GPT-6.1 Sol / High | Planned |
| RA-10 | Host lifecycle qualification | GPT-6.1 Sol / High | Planned |
| RA-11 | Architecture and adoption review | Astra / High | Planned |

Before RA-06, the [nonterminal lifecycle proof](../nonterminal-lifecycle/README.md)
qualifies a fixed private service followed by ordinary core fetch against the
shared lifecycle points. Its 38 compiled-Native cases and five mutation oracles
support the bounded cache mapping next; cache admission and real-host disposition
remain unqualified.

Review the contract after RA-02, executable behavior after RA-07, and adoption
after RA-11. RA-05/06 can separate once their shared service is stable. Each unit
ends with its own reviewable result against `hex-integration`; this plan grants
no merge/release authority. General callbacks, nested composition, migration of
all ABIs, and ESP32 driver implementation remain outside the first milestone.
