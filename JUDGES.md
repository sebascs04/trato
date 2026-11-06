# Testing Trato — guide for judges

**Trato is a workspace for freelancers where every phase of a project leaves documentary evidence, and getting paid is tied to that evidence.** The initial agreement, the client's change requests, each addendum version, the client's acceptance and the sign-off of every deliverable are kept as documents in the project. **Gemini** agents read those documents to propose plans and changes (always citing them), and **PayPal** payments are only marked as paid when the backend verifies the capture. Hosted on **Google Cloud**.

- **Live demo:** https://trato-web-68896425401.us-central1.run.app
- **Everything runs on PayPal Sandbox.** No real money is moved.
- **Judge login and PayPal Sandbox buyer account:** see the Devpost submission (testing instructions). They are not stored in this public repository.
- **Interface language:** English or Spanish, in *Profile → Language*.

## How a project works in Trato

| Phase | Document that proves it | What Trato does |
|---|---|---|
| Start | Initial conversation / agreement | AI proposes deliverables and staged payments from the agreement |
| Delivery | Client's sign-off of each deliverable | AI checks the sign-off; the client pays that stage with PayPal |
| Change | Client's change request | AI compares it with the agreement and drafts scope, conditions and effort; you set your rate |
| Addendum | Versioned PDF sent from Gmail | Each version keeps its own PDF, sending and acceptance |
| Payment | PayPal capture verified by the backend | Only then the change or stage is marked as paid |
| Audit | Project history and map | Every phase above, with its documents, in one timeline |

## Step-by-step test (about 15 minutes)

Follow **[ejemplos/cafe-aurora-en/README.md](ejemplos/cafe-aurora-en/README.md)**. It uses ready-made fictional PDFs for a small website project (Café Aurora). You will:

1. Create a client and a project from the agreement. AI proposes a plan with three paid deliverables.
2. Get paid for each deliverable. Upload the client's sign-off, AI verifies it, and the client pays through PayPal Sandbox.
3. Turn a scope change into a paid addendum. AI drafts it from the documents, the client asks for adjustments, a new version is sent, and the client accepts and pays.
4. Open the project history and map to see every phase with its documents, ask the project assistant, and try a negotiation rehearsal.

Your judge account may also include an example project you can open first to see the result.

### Paying as the client

In real use the client receives the payment link by email. Use your own email as the client's contact email to see those emails arrive. While PayPal is in Sandbox, a **Test mode (PayPal Sandbox)** box also lets you open the same checkout directly with **Open test payment**. Log in with the **Sandbox buyer account provided in Devpost** and approve. Please use that account rather than your own Sandbox account: for deliverables, Trato verifies that the payer is the buyer linked to the client and rejects any other. The payment counts only after Trato's backend verifies the capture with PayPal.

## Notes

- AI steps run in background workers. A visible error means a step failed. Trato never fakes a result.
- Only a capture verified by the backend counts as paid. Returning from PayPal does not.
- To run Trato locally instead, see [README.md](README.md). You will need your own PayPal Sandbox, Supabase, Gemini and Weaviate credentials.
