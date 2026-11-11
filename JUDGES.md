# Testing Trato: a guide for judges

**Trato is a workspace for freelancers where every phase of a project leaves documentary evidence, and getting paid is tied to that evidence.** The initial agreement, the client's change requests, each addendum version, the client's acceptance and the sign-off of every deliverable are kept as documents in the project. **Gemini** agents read those documents to propose plans and changes (always citing them), and **PayPal** payments are only marked as paid when the backend verifies the capture. TeTrato, Trato's agent, works on PayPal for the freelancer through the official **PayPal Agent Toolkit**: it issues invoices, explains stuck payments and prepares dispute responses, always after the freelancer confirms. Hosted on **Google Cloud**.

- **Live demo:** https://trato-web-68896425401.us-central1.run.app
- **Everything runs on PayPal Sandbox.** No real money is moved.
- **Judge login and PayPal Sandbox buyer account:** see the Devpost submission (testing instructions). They are not stored in this public repository.
- **Interface language:** English or Spanish, in *Profile → Language*.

## How a project works in Trato

| Phase | Document that proves it | What Trato does |
|---|---|---|
| Start | Initial conversation / agreement | AI proposes deliverables and staged payments from the agreement |
| Delivery | The delivery and the client's approval in Trato | The client approves it or says what is missing; only an approved stage is charged |
| Change | Client's change request | AI compares it with the agreement and drafts scope, conditions and effort; you set your rate |
| Addendum | Versioned PDF sent by email | Each version keeps its own PDF, sending and acceptance |
| Client's answer | Acceptance or change request in the client portal | The client reviews from a secure link, with no account needed |
| Payment | PayPal's own buttons inside Trato, or a PayPal invoice issued by TeTrato | Paid only when the backend verifies the capture with PayPal |
| Refund | The client's refund request and its proof | The freelancer refunds the original PayPal payment in one step, from Trato |
| Problem | The client's report in Trato and its conversation | The freelancer replies or turns it into a new request; only the client closes it |
| Dispute | The project's evidence | A dispute on a verified payment (deliverable or addendum) is flagged on the home page and opens in the project, with a response prepared from that evidence |
| Audit | Project history and map | Every phase above, including each step the client takes, with its documents, in one timeline |

## Step-by-step test (about 15 minutes)

Please start by reading **[ejemplos/cafe-aurora-en/README.md](ejemplos/cafe-aurora-en/README.md)**: it is the user manual for testing Trato with that folder and its sample documents. It tells the story of a small website project for Café Aurora and shows, for every PDF, where it goes in Trato and which button to press. Along the way you will:

1. Create a client and a project from the agreement. AI proposes a plan with three paid deliverables.
2. Get paid for each deliverable. Send the delivery, approve it as the client, and send the payment request. The client pays through PayPal Sandbox.
3. Turn a scope change into a paid addendum. AI drafts it from the documents. Acting as the client in the portal, you request changes, then accept the new version and pay.
4. Open the project history and map to see every phase with its documents, ask the project assistant, and try a negotiation rehearsal.

### Your judge accounts are already loaded

The judge **freelancer** account has three projects for the client **Café Aurora**, and the judge **client** account sees the same three projects from the client's side:

- **Café Aurora website (completed example):** all three deliverables and the store addendum paid, with its history, map and documents. A PayPal dispute is open on one payment, with TeTrato's response prepared and not sent.
- **Café Aurora website (plan ready):** the first deliverable approved and paid; the rest is yours to try.
- **Café Aurora website (started before Trato):** a project that began outside Trato. TeTrato planned only the work that was left, and a delivery waits for the client's approval.

To receive Trato's emails yourself, create your own account with your real email and follow the step-by-step test.

### Paying as the client

Use your own email as the client's contact email so that the client's emails reach you.

- **Addenda:** the email links to the client portal. There you can **Request changes**, **Accept addendum** and **Pay with PayPal**, without a Trato account.
- **Deliverables:** sign up in Trato with the client's email and choose **Client**. In **My projects**, open the project and its **Work plan**: each deliverable shows **Approve delivery** or **Something's missing**, then PayPal's own payment buttons, right inside Trato, or **Pay invoice in PayPal**. The payment email links to the same payment.
- **Ask TeTrato (client):** the button in the corner answers questions about the client's own projects, such as *"How much have I paid?"*, with the records it used. In the portal it can also accept an addendum or open its payment, always after the client confirms.

Log in with the **Sandbox buyer account provided in Devpost**, or any PayPal Sandbox buyer account, and approve. Like a real client's accountant or company account, any PayPal account can pay. Trato verifies the order, amount, receiving merchant and currency, and the payment counts only after its backend verifies the capture with PayPal.

### Optional: a PayPal invoice issued by TeTrato

After sending a deliverable's payment email, **Still unpaid?** appears in **Delivery and payment**. Click **Send PayPal invoice**: TeTrato writes the invoice concept from the agreement, and **Confirm and send** issues the invoice in PayPal and emails the client its link. The earlier payment link stops working, so the client pays once, with **Pay invoice in PayPal**. An accepted addendum offers **Send PayPal invoice** too. **Why hasn't it gone through?** asks TeTrato to read the payment in PayPal and explain its state.

### Optional: a refund

As the client, **Request a refund** on a paid deliverable or addendum and say why. As the freelancer, open **Refunds** in the project: TeTrato can draft the decision from the evidence, and **Refund with PayPal** returns the money from the original payment after you confirm it in a PayPal-style window.

### Optional: a PayPal dispute

After paying a deliverable or an addendum, open a dispute on that payment as the buyer at https://www.sandbox.paypal.com/resolutioncenter (**Report a Problem**). A few minutes later, reload Trato's home page: **A client opened a PayPal dispute** appears. Click **Open dispute**, then **Prepare response with TeTrato** for a reply that cites the project's documents. Nothing goes to PayPal until you click **Send to client**.

### Optional: a problem reported in Trato

On a paid addendum with no PayPal dispute, the client portal shows **Report a problem** under the payment: choose a reason, describe it and click **Send to my freelancer**, or let **Ask TeTrato** draft it. As the freelancer, **A client reported a problem** appears on the home page; **Open** leads to **Disputes & problems → Client problems**, where you **Reply** or click **Register as new request** to open the usual request form with the report attached. Back in the portal, the client closes it with **It's resolved** or **Still not resolved**.

### Optional: a project that already started

Choose **New project → The project is already underway**, upload what you already agreed (agreement, conversations, deliveries) and choose each document's type. TeTrato proposes a plan for **only the work that is left**, with the amount still to be paid.

### Fixing an upload mistake

In the project's **Documents**, **Change type** or **Remove** corrects a document uploaded by mistake, as long as nothing relies on it yet. Documents that an addendum, a payment, a delivery the client saw, a refund or a dispute already rely on stay locked as evidence.

## Notes

- AI steps run in background workers. A visible error means a step failed. Trato never fakes a result.
- Only a capture verified by the backend counts as paid. Returning from PayPal does not.
- To run Trato locally instead, see [README.md](README.md). You will need your own PayPal Sandbox, Supabase, Gemini and Weaviate credentials.
