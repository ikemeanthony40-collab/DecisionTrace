# DecisionTrace

**A deterministic, auditable policy decision system with human oversight.**

DecisionTrace is a policy-driven decision platform that evaluates applications against structured policy rules, produces explainable recommendations, and provides a controlled human-review process for cases requiring additional attention.

The system separates automated recommendations from human review decisions, preserving the original machine recommendation and maintaining an audit trail of review actions.

## Key Features

- **Policy management:** Store and activate policies with version information.
- **Rule-based evaluation:** Evaluate submitted applications against structured policy rules.
- **Deterministic decisions:** Produce one of three recommendations:
  - `APPROVED`
  - `DENIED`
  - `ESCALATED`
- **Evidence snapshots:** Preserve the policy rule evidence used when a decision was made.
- **Human review:** Allow authorised reviewers to act on escalated decisions with a mandatory reason.
- **Audit history:** Record important system and review activities.
- **Role-based access:** Separate administrator and reviewer permissions.
- **Persistent storage:** Use SQLite to store policies, decisions, reviews, and audit records.

## How It Works

1. An administrator manages the policy and its rules.
2. An applicant submits an application.
3. DecisionTrace evaluates the submitted information against the applicable rules.
4. The system records a recommendation:
   - `APPROVED` when the applicable validated rules pass.
   - `DENIED` when a validated rule fails and no missing information requires escalation.
   - `ESCALATED` when information is missing or a rule requires human validation.
5. A reviewer can review an escalated decision and record an action with a reason.
6. The original machine recommendation remains preserved, while the review outcome and audit history are stored separately.

## Technology Stack

| Area | Technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express, TypeScript |
| Database | SQLite using better-sqlite3 |
| Authentication | JWT |
| Password hashing | bcryptjs |
| Validation | Zod |
| Automated testing | Vitest, Supertest |
| Package management | pnpm |
| Development environment | Kiro IDE |

## Project Structure

Kiroween2026/
|-- .kiro/
|   `-- specs/
|       `-- decision-trace/
|           |-- requirements.md
|           `-- design.md
|-- packages/
|   |-- backend/
|   |   |-- src/
|   |   |   |-- auth/
|   |   |   |-- db/
|   |   |   |-- decisions/
|   |   |   `-- policies/
|   |   |-- tests/
|   |   `-- package.json
|   `-- frontend/
|       |-- src/
|       `-- package.json
|-- .gitignore
|-- package.json
|-- pnpm-lock.yaml
|-- pnpm-workspace.yaml
`-- tsconfig.base.json
The `.kiro` directory contains the project specifications used during development.

## Prerequisites

Install the following before setting up the project:

- Node.js
- pnpm
- Git (for cloning the repository)

The project uses pnpm workspaces to manage its frontend and backend packages.

## Installation

Clone the repository:

```powershell
git clone https://github.com/ikemeanthony40-collab/DecisionTrace.git
cd DecisionTrace
```

Install dependencies:

```powershell
pnpm install
```

## Environment Configuration

Create a `.env` file in the project root directory.

Add the following configuration, replacing the example password values with your own strong passwords:

```env
PORT=3001
JWT_SECRET=replace_with_a_random_secret_at_least_32_characters_long

ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace_with_a_strong_password_at_least_12_characters

REVIEWER_USERNAME=reviewer
REVIEWER_PASSWORD=replace_with_a_different_strong_password_at_least_12_characters
```

Important:

- `JWT_SECRET` must contain at least 32 characters.
- Both account passwords must contain at least 12 characters.
- `ADMIN_USERNAME` and `REVIEWER_USERNAME` are optional; the default values are `admin` and `reviewer`.
- Do not commit your `.env` file or share its secret values.
- The application loads the root `.env` file when the backend is started from its package directory.

## Database Setup

Initialise the SQLite database:

```powershell
pnpm --filter @decisiontrace/backend db:init
```

Create the sample users, policy, rules, and initial audit event:

```powershell
pnpm --filter @decisiontrace/backend seed
```

The seed command creates:

- An administrator account.
- A reviewer account.
- The Greenleaf Community Innovation Fund sample policy.
- Six sample policy rules.
- An initial policy-ingestion audit event.

The sample policy is created only if it does not already exist. Running the seed command again will not recreate that policy.

## Running the Application

From the project root, run:

```powershell
pnpm dev
```

The development servers run in parallel.

Open the frontend:

**http://127.0.0.1:5173**

The backend API runs on:

**http://localhost:3001**

Health check:

**http://localhost:3001/api/health**

## Automated Tests

Run the complete test command from the project root:

```powershell
pnpm test
```

The backend test suite covers decision evaluation, database persistence, and HTTP route behaviour.

The current backend suite contains 27 passing tests. The frontend test command is configured to pass when no frontend test files are present.

## Production Build

Build the frontend and backend:

```powershell
pnpm build
```

## Authentication and Roles

DecisionTrace provides two application roles:

**Administrator**
- Access administrative functionality.
- Manage policy-related activities.
- View decision history.

**Reviewer**
- Access the review queue.
- Review escalated decisions.
- Record a review action with a reason.

Access to protected backend routes requires a valid JWT authentication token.

## Kiro Development

DecisionTrace was developed using **Kiro IDE** and a specification-driven workflow.

The project specifications are maintained in:

```text
.kiro/specs/decision-trace/requirements.md
.kiro/specs/decision-trace/design.md
```

These documents describe the requirements, architecture, design decisions, and expected system behaviour.

## Current Project Status

The application includes policy evaluation, decision records, reviewer actions, audit history, authentication, and automated backend tests.

The project is being prepared for public release and demonstration.

## License

License

DecisionTrace is released under the MIT License.

Copyright (c) 2026 ANTHONY MBADIWE IKEME

See the [LICENSE](LICENSE) file for details.

## Demo

Demo video and hosted application links will be added when available.