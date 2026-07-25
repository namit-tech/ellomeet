# Room security — phased plan

## The problem

Room identity is whatever the user types, and the server creates a room on the
first join (`ensure`). So a short, guessable code like `001` is:

- **collidable** — two unrelated tenants type `001` and land in the same room;
- **enumerable** — a script tries `001`, `002`, … and walks into live meetings;
- **conjurable** — typing a code that does not exist *creates* it, so there is
  no "meeting not found" wall at all.

Google Meet and Zoom solve this by making the identifier itself the security
boundary: a long, server-minted, unguessable code (a capability URL), and
joining a code that was never created is rejected. Good codes stop guessing;
splitting join from create stops conjuring a room by typing its name. Both are
needed.

---

## Phase 1 — Unguessable codes + join ≠ create  ← the core fix

The 90% fix, and fully contained: it does not touch LiveKit, the SFU, or the
media path.

- **Mint** codes on the server with a CSPRNG (`crypto`), from an unambiguous
  alphabet, formatted `xxx-xxxx-xxx` (Meet-style, ~50 bits — collision and
  enumeration become statistically impossible).
- **Reserve** the code briefly when minted (a short TTL "issued" record).
- **Join ≠ create.** Joining a code goes through:
  - room already active → join it;
  - room absent but the code was freshly minted → create it, first joiner is
    host, consume the reservation;
  - room absent and code was never minted → **"meeting not found"**.
- `Math.random()` on the client (predictable) is removed. The client can no
  longer choose or invent a room id — it asks the server for one.

This kills enumeration and the "type `001` and become the room" hole, while the
existing lock / waiting room / co-host stay as the second layer.

---

## Phase 2 — Per-room passcode (optional second factor)

Defense in depth, Zoom-style. A room may carry an optional passcode set at
creation; joining requires it before admission. Even if a capability link leaks,
the passcode is a second wall. Cheap, self-contained, no new infrastructure.

---

## Phase 3 — Tenancy (multi-client namespacing)

For selling to many companies who want their own memorable/permanent codes.

- Each client is a **tenant** (own subdomain or URL prefix).
- Codes are unique **within** a tenant: `acme`'s `standup` ≠ `globex`'s
  `standup`. No cross-tenant collision by construction.
- **Reserved / persistent** codes (a company's permanent room, like Zoom's PMI)
  must survive an empty room, so they live in the store (the Valkey layer from
  the scaling plan already provides this).

Needs a product decision: which codes are ephemeral (ad-hoc meetings) and which
are reserved (recurring/tenant rooms).

---

## Phase 4 — Host authentication

Ties room creation to a real identity: host login, domain restriction (only
`@acme.com` may host), and an audit trail. Guests still join by link. This is
the point where "who is allowed to create rooms at all" becomes enforceable
rather than open to anyone who can reach the mint endpoint.

---

## Sequencing

Phase 1 is the one that closes the vulnerability you identified and is safe to
ship on its own. Phase 2 is a small hardening on top. Phases 3 and 4 are product
decisions (tenancy model, auth provider) and are planned, not yet built.
