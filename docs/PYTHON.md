# Python conventions (dsh-fin-agent)

Repo-wide Python style. Keep it short and enforceable — when a rule conflicts with
`docs/DESIGN_REVIEW.md`, the design doc wins and this file gets updated.

## Annotations

- Type annotations on every public function/method (args + return); non-trivial internal helpers too
- `from __future__ import annotations` in modules with forward references or heavy typing imports — deferred
  evaluation keeps import cost low and avoids circular imports
- Prefer precise types over loose ones:
  - `dict[str, Any]` is a smell — reach for `@dataclass`, `TypedDict`, or `NamedTuple` first
  - Accept `Sequence`/`Iterable` in signatures where the caller may pass any iterable
  - Use `NewType`/`Literal` for domain-meaningful strings (symbol codes, asset classes)

## Models

- Domain models are `@dataclass(frozen=True)` when the row is immutable (most data rows)
- Units and currency are explicit fields, never implicit (see `docs/DATA_MODEL.md`)
- Timestamps are `int` ms since epoch in Asia/Shanghai — never naive `datetime` (L2 fixed, see DATA_MODEL)

## Iteration

- Prefer lazy iteration (generators, `yield`) over materializing full lists for large datasets
  (e.g. full-market snapshots); no eager `list(...)` wrap unless the consumer needs random access

## Errors

- Raise typed `FinError` subclasses from the error taxonomy (AUTH / QUOTA / RATE_LIMIT / TIMEOUT / NO_DATA / BAD_REQUEST);
  never bare `Exception` at the data-layer boundary (full decision table: `docs/DEGRADATION.md`)

## Imports

- `core/` never imports mcp/dsh/DSH packages (protocol-free by intent); protocol lives in `servers/`
