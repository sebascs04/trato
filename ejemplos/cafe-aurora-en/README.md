# Café Aurora: sample case for testing Trato

Fictional documents for a complete freelance project. You create the client and the project from scratch, get paid for each deliverable through PayPal Sandbox, and turn a scope change into a paid addendum. Everything here is fictional; no real money is moved.

You need:

- The Trato login and the PayPal Sandbox buyer account from the Devpost submission.
- The PDFs in this folder. `sources/` has their editable text, and `generate.py` rebuilds them.

| File | Use it when |
| --- | --- |
| `01-initial-conversation.pdf` | Creating the project (starting information) |
| `02-initial-agreement.pdf` | Adding the confirmed initial agreement |
| `03-change-request-store.pdf` | Registering the client's change request |
| `04-client-adjustments-addendum-v1.pdf` | Registering the client's feedback on addendum v1 |
| `05-client-acceptance-addendum-v2.pdf` | Registering the client's acceptance of addendum v2 |
| `06-deliverable-1-acknowledgment.pdf` | Delivery evidence for deliverable 1 (USD 180) |
| `07-deliverable-2-acknowledgment.pdf` | Delivery evidence for deliverable 2 (USD 300) |
| `08-deliverable-3-acknowledgment.pdf` | Delivery evidence for deliverable 3 (USD 120) |

## 1. Sign in and look at the completed example

Open the demo URL and sign in with the Trato login from Devpost. If the interface is in Spanish, switch it in **Profile → Language → English**.

Your account already has a finished project built with these same documents: client **Café Aurora (example)**, project **Café Aurora website — completed example**. Open it first. All three deliverables and the store addendum are paid, and its map, history and documents are complete. Then build your own copy from scratch with the steps below.

## 2. Create the client

Go to **Clients → New client**.

- **Name:** `Café Aurora`
- **Contact email:** an inbox you can check. Trato sends the addendum and payment emails there.

## 3. Create the project

Open the client and choose **New project**, then the option to start a new project.

- **Project name:** `Café Aurora website`
- **Brief:**
  > Design and development of a responsive five-section website in English for Café Aurora: Home, Menu, About us, Gallery and Contact. Includes an inquiry form, two rounds of revisions and launch. The client provides copy, photos and logo. Budget: USD 600. Delivery: November 20, 2026. Payments agreed with the client, each after its deliverable is approved: USD 180 for planning and initial UI design, USD 300 for website development and USD 120 for testing and launch. Not included: store, cart, online payments, user accounts, inventory or translations.
- **Starting document:** `01-initial-conversation.pdf`

Trato extracts the text of the PDF, and its AI proposes a work plan from the brief, that conversation, the budget and the date. Review the plan before confirming, and edit any stage that does not match the agreement. It should have three deliverables:

1. Planning and initial UI design: USD 180
2. Website development: USD 300
3. Testing and launch: USD 120

Confirm to create the project. When Trato asks for the initial agreement, upload `02-initial-agreement.pdf`.

## 4. Get paid for each deliverable

Repeat these steps for deliverables 1, 2 and 3, in order. A deliverable can be charged only after the previous one is paid.

1. In the work plan, open the deliverable and choose **Delivery and payment**.
2. **Attach delivery evidence:** upload `06-…`, `07-…` or `08-…` for that deliverable. An AI agent checks that the client confirms the stage is complete. You can keep working while it processes.
3. When the document shows as processed, click **Prepare payment request**.
4. Click **Send payment email**, review the email and send it to the client.
5. **Pay as the client.** In real use the client pays from the email. To test, click **Open test payment** in the *Test mode (PayPal Sandbox)* box, or use the link in the email you received. Log in to PayPal with the Sandbox buyer account from Devpost, or any PayPal Sandbox buyer account, and approve the payment.
6. Back in Trato, click **Check payment**. The deliverable is marked as paid only after the backend verifies the capture with PayPal.

## 5. Turn a scope change into a paid addendum

1. Open **Changes** and click **Register client request**. Upload `03-change-request-store.pdf`.
2. Trato's AI compares the request with the agreement and drafts **addendum v1**: an online store with ten products, USD 240 extra. Review it, save its PDF and **Send addendum**.
3. The client asks for changes. Click **Register client feedback** and upload `04-client-adjustments-addendum-v1.pdf`. Trato drafts **addendum v2**: five products, USD 180 extra. Review it and send it.
4. The client accepts. Click **Register received acceptance**, upload `05-client-acceptance-addendum-v2.pdf` and save the reviewed acceptance.
5. Click **Prepare payment request →**, then **Send payment request →**.
6. Pay as the client: use **Open test payment** or the email link, and approve with the Sandbox buyer account.
7. Click **Verify payment ↻**. Once paid, the change becomes read-only. Any new adjustment is a separate request.

## 6. Explore the rest

- **Project map:** the agreement, requests, addenda, acceptances and payments as a graph.
- **TeTrato assistant:** ask *"What is included in deliverable 2?"* or *"How much has the client paid so far?"*. Answers cite the project's own documents.
- **Rehearsals:** practice a scope-creep conversation with an AI client, then choose **End practice → Analyze with AI** for coaching with cited sources.
