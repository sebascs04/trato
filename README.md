# Trato

> **Judges:** start with **[JUDGES.md](JUDGES.md)**. It has the live demo, the test accounts and a 15-minute walkthrough.

**Trato helps freelancers get paid for what they agreed, and for every change along the way.** Each phase of a project leaves a document behind: the agreement, the client's change request, every addendum version, the acceptance and the sign-off of each deliverable. AI agents read those documents and prepare the next step. A person approves it, and PayPal handles the payment. TeTrato, Trato's agent, works on PayPal for the freelancer through the official PayPal Agent Toolkit: it issues invoices, explains stuck payments and prepares dispute responses.

**Live demo:** https://trato-web-68896425401.us-central1.run.app (PayPal Sandbox, no real money is moved)

## The problem

Scope changes are usually agreed in loose messages. The work grows, the price does not, and when a payment is late or disputed the freelancer has no clear record of what was agreed.

## What Trato does

| For | Feature | How it works |
|---|---|---|
| Freelancer | **Plan from the agreement** | AI proposes deliverables and staged payments from the project's documents |
| Freelancer | **Projects already underway** | Upload what was already agreed and done elsewhere; AI plans only the work that is left and its remaining amount |
| Both | **Approved deliverables** | The freelancer sends each delivery; the client approves it or says what is missing in their account, and only an approved stage is charged |
| Client | **Pay inside Trato** | PayPal's official buttons (JavaScript SDK) on every payment the client makes; the backend creates the order and verifies the capture |
| Freelancer | **PayPal invoices by TeTrato** | Agentic commerce: TeTrato writes the concept and issues a PayPal invoice through the official PayPal Agent Toolkit for an addendum or a deliverable, after the freelancer confirms |
| Freelancer | **Payment detective** | TeTrato reads the payment's live state in PayPal and explains in plain words why it has not gone through and what to do |
| Freelancer | **Addenda from change requests** | AI compares the request with the agreement and drafts scope, conditions and effort. Each version keeps its own PDF, delivery and acceptance |
| Client | **Client portal** | Review, request changes, accept and pay from a secure emailed link, with no account needed. An optional client account opens each project with its work plan, changes, and disputes and problems |
| Client | **Report a problem** | After paying, the client reports a problem in Trato, or TeTrato drafts it. The freelancer replies or turns it into a new request; only the client closes it, and the conversation stays as evidence |
| Both | **Refunds** | The client requests a refund with its reason; TeTrato drafts the decision from the evidence and the freelancer refunds the original PayPal payment in one step |
| Freelancer | **PayPal disputes** | A new dispute on a verified payment, for a deliverable or an addendum, is flagged on the home page. It opens in the project, read through the official PayPal Agent Toolkit, with a response prepared from the project's evidence that the freelancer reviews and sends |
| Both | **TeTrato assistant** | Answers the freelancer's questions about a project, and the client's about their own projects and payments, citing the records it used |
| Freelancer | **Rehearsals** | Practice a difficult conversation with an AI client, then get coaching with cited sources |
| Both | **History and map** | Every phase and document, in one timeline and one graph. The timeline also records each step the client takes: change requests from the portal, approvals of each delivery and every payment request sent |

**Rules the code enforces**

- Agents never send email or move money without a person's approval.
- Only a capture verified by the backend counts as paid. Returning from PayPal or sending an email does not.
- One way to collect each payment: issuing a PayPal invoice retires the checkout link, so a client can never pay twice.
- A paid change is read-only. New work becomes a separate request.
- Agent output is JSON validated in code. If a step fails, Trato shows the error and never fakes a result.

## How it is built

```
Browser (vanilla JS modules)
   │
   ▼
trato-api (FastAPI)  ── authorizes, validates, talks to PayPal, Gmail and Supabase
   │        │
   │        └── trato-file-processor ── extraction, embeddings, Weaviate search
   ▼
Redis queue ── trato-worker (LangGraph + Gemini) ── generic processes defined by their input
```

| Layer | Technology |
|---|---|
| **Payments** | PayPal Sandbox: JavaScript SDK buttons, Orders, Invoicing, Refunds, Disputes, webhooks and the PayPal Agent Toolkit |
| **AI** | Google Gemini through LangGraph and LangChain |
| **Data** | Supabase (Postgres with row-level security, Auth, Storage), Neo4j (project graph), Weaviate (vector search) |
| **Email** | Gmail API |
| **Hosting** | Google Cloud (Cloud Run and Compute Engine) |

## Repository layout

| Folder | Purpose |
|---|---|
| Root (`index.html`, `connected-workspace.mjs`, `portal.html`…) | Web product and client portal |
| `repos/trato-api` | **The backend:** authentication, business rules, persistence, Gmail and PayPal |
| `repos/trato-worker` | Agent graphs, model contracts and job execution |
| `repos/trato-file-processor` | Validation, extraction, chunking and Weaviate operations |
| `repos/trato-web` | Optional technical tool, not the product interface |
| `supabase` | Database migrations, policies and SQL tests |
| `deploy` | Google Cloud images and deployment |
| `ejemplos/cafe-aurora-en` | Fictional documents for testing the full flow |
| `tests`, `scripts`, `locales`, `assets` | Frontend tests, tooling, English and Spanish text, static files |
| `docs` | Design notes and decisions, mostly in Spanish |
| `backend` | Earlier prototype. The product runs on `repos/trato-api` |

## Run it locally

The hosted demo is the quickest way to try Trato. To run it yourself you need Node.js 18+, Python 3.12, Redis, Poppler (`pdftotext`) and your own PayPal Sandbox, Supabase, Gemini and Weaviate credentials. Ports are listed in `local-ports.json`.

```bash
git clone https://github.com/sebascs04/trato.git
cd trato
npm ci
```

Set up the Python environments and services with [docs/colaboradores.md](docs/colaboradores.md) (in Spanish). Each `.env.example` lists what a service needs and contains no credentials. Then start everything:

```bash
python3 scripts/dev-polyrepo.py --with-worker
```

Open http://localhost:5173.

## Tests

```bash
# Frontend
npm run check
node --test tests/*.test.mjs
node scripts/check-i18n.mjs

# Browser tests (need the local server and Chromium libraries)
npx playwright install chromium
npm run test:browser

# API, from repos/trato-api
PYTHONPATH=../trato-file-processor ../trato-file-processor/.venv/bin/python -m unittest discover -s tests

# Worker, from repos/trato-worker
.venv/bin/python -m unittest discover -s tests
```

## License

See [LICENSE](LICENSE).
