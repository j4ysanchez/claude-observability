<!--
Sync Impact Report
Version change: [TEMPLATE — unratified] → 1.0.0 (initial ratification)
Modified principles: n/a (first concrete adoption of the template)
Added sections:
  - I. Simplicity First
  - II. Immutable Data, Pure Functions
  - III. Composability Over Inheritance
  - IV. Decoupling Through Explicit Boundaries
  - V. Secure by Default
  - Technology & Architecture Constraints
  - Development Workflow
  - Governance (versioning policy, amendment procedure)
Removed sections: none (all template placeholders replaced)
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no change needed (Constitution Check
    section is dynamically populated per feature; no hardcoded principle refs)
  - .specify/templates/spec-template.md ✅ no change needed (no principle-specific
    hardcoded content)
  - .specify/templates/tasks-template.md ✅ no change needed (generic task
    categories already compatible; e.g. "Security hardening" in Polish phase)
  - .claude/skills/speckit-*/SKILL.md ✅ reviewed — all references load the
    constitution dynamically at runtime, none hardcode principle names
Follow-up TODOs: none
-->

# Claude Observability Constitution

## Core Principles

### I. Simplicity First
Every design decision MUST favor the simplest solution that satisfies the actual,
current requirement. Do not build for hypothetical future needs (YAGNI); do not
introduce a framework, abstraction, or layer of indirection until a second concrete
use case proves it necessary. Prefer plain data and plain functions over classes,
managers, and factories. Complexity that cannot be justified by a present
requirement MUST be removed or rejected in review.

**Rationale**: Simple systems are the ones that stay secure, composable, and
decoupled over time — every other principle in this constitution erodes faster in a
complex system than in a simple one.

### II. Immutable Data, Pure Functions
Data structures MUST be immutable by default: state changes produce new values
rather than mutating existing ones. Business logic MUST be implemented as pure
functions — same input, same output, no hidden side effects — with I/O, mutation,
and other effects isolated at the system's edges (an "imperative shell" around a
"functional core"). Shared mutable state is prohibited unless explicitly justified
in writing (see Complexity Tracking in the plan template).

**Rationale**: Immutability and purity eliminate whole classes of concurrency bugs
and unintended side effects, make code trivially testable without mocks, and remove
the temporal coupling that makes systems hard to reason about and hard to secure.

### III. Composability Over Inheritance
Functionality MUST be built from small, single-purpose functions and modules
composed together, not from inheritance hierarchies or God objects. Every function
and module MUST have a narrow, well-documented contract (inputs, outputs, effects)
so it can be recombined in contexts its author did not anticipate. Prefer function
composition, pipelines, and higher-order functions over subclassing or shared base
classes.

**Rationale**: Composable units are independently understandable, testable, and
reusable; inheritance and shared base classes create tight coupling that spreads
unpredictably as the system grows.

### IV. Decoupling Through Explicit Boundaries
Modules MUST communicate only through explicit, well-defined interfaces (function
signatures, typed contracts, message schemas) — never through shared mutable state,
global variables, or reach-through access to another module's internals. Every
dependency MUST be explicit (passed in, not reached for), enabling any module to be
replaced, tested, or reasoned about in isolation. Cross-module changes that require
touching internals of more than one module simultaneously are a signal the boundary
is wrong and MUST be redesigned.

**Rationale**: Explicit boundaries are what make a system composable and
independently deployable/testable; implicit coupling is invisible until it breaks
something far away from the change that caused it.

### V. Secure by Default
Security MUST be a default property of the design, not a layer added afterward.
Every external boundary (network input, file input, user input, third-party
response) MUST validate and sanitize data before it enters the functional core.
Systems MUST run with least privilege, secrets MUST NOT be hardcoded or logged, and
mutable global state — a common source of privilege leakage and injection bugs —
MUST be avoided per Principle II. Any deviation from a secure default MUST be
justified explicitly and reviewed.

**Rationale**: Immutability and pure functions already remove many attack surfaces
(no ambient state to corrupt); making that the default posture, rather than an
opt-in, keeps security cheap instead of retrofitted.

## Technology & Architecture Constraints

Implementation languages and frameworks MUST support first-class functions,
immutable data structures (or persistent/immutable collection libraries), and pure
function composition. Object-oriented patterns (inheritance, mutable shared
instances, singletons) MAY be used only where the host language or an unavoidable
third-party API leaves no functional alternative, and each such use MUST be noted
inline with a comment explaining the constraint. Side-effecting code (I/O, network,
persistence, logging) MUST be isolated into thin, clearly named boundary modules
separate from core logic, so the majority of the codebase remains pure and
independently testable.

## Development Workflow

Code review MUST verify compliance with all five Core Principles before merge;
reviewers treat MUST-language violations as blocking, not advisory. Because pure
functions and immutable data require no mocking, unit tests SHOULD be written
against the functional core directly (real inputs, real outputs, no test doubles);
integration or contract tests are reserved for the boundary modules where effects
occur. Any exception to a Core Principle MUST be recorded with its rationale in the
relevant plan's Complexity Tracking table rather than merged silently.

## Governance

This constitution supersedes all other project practices, style guides, and
prior conventions where they conflict. Amendments require: (1) a documented
rationale for the change, (2) a version bump per the policy below, and (3)
propagation of the change to any dependent templates (`plan-template.md`,
`spec-template.md`, `tasks-template.md`) and skill definitions in the same change.

**Versioning policy** (semantic versioning for governance):
- **MAJOR**: Backward-incompatible removal or redefinition of a Core Principle.
- **MINOR**: A new principle or section is added, or existing guidance is
  materially expanded.
- **PATCH**: Wording clarifications, typo fixes, or non-semantic refinements.

All pull requests and reviews MUST verify compliance with this constitution.
Complexity that violates a Core Principle MUST be justified in writing (see
Development Workflow) or rejected. This document does not codify runtime
development commands or tooling guidance; such guidance belongs in
project-level agent instructions (e.g., `CLAUDE.md`) and MUST NOT contradict
the principles defined here.

**Version**: 1.0.0 | **Ratified**: 2026-08-03 | **Last Amended**: 2026-08-03
