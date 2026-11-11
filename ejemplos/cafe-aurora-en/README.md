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
| `06-deliverable-1-acknowledgment.pdf` | Sending deliverable 1 to the client (USD 180) |
| `07-deliverable-2-acknowledgment.pdf` | Sending deliverable 2 to the client (USD 300) |
| `08-deliverable-3-acknowledgment.pdf` | Sending deliverable 3 to the client (USD 120) |

## 1. Sign in and look at the completed example

Open the demo URL and sign in with the Trato login from Devpost. If the interface is in Spanish, switch it in **Profile → Language → English**.

Your account already has a finished project built with these same documents: client **Café Aurora (example)**, project **Café Aurora website (completed example)**. Open it first. All three deliverables and the store addendum are paid, and its map, history and documents are complete. Then build your own copy from scratch with the steps below.

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
2. Attach `06-…`, `07-…` or `08-…` for that deliverable and click **Send to client for review**.
3. **Approve it as the client.** The first time, sign up in Trato with the client's email and choose **Client** (see step 6). Open **My projects → Café Aurora website → Work plan**, open the deliverable, click **View delivery**, then **Approve delivery**. **Something's missing** sends a note instead, and the freelancer sends a corrected delivery.
4. Back as the freelancer, click **Send payment request**. Trato prepares the PayPal payment and emails it to the client in one step.
5. **Pay as the client** with **Pay with PayPal** on the deliverable, or from the email. Log in to PayPal with the Sandbox buyer account from Devpost, or any PayPal Sandbox buyer account, and approve the payment.
6. Reopen **Delivery and payment**: Trato checks PayPal and shows **Payment verified by PayPal** once the backend verifies the capture.

**PayPal invoice instead:** after the payment email, **Still unpaid?** offers **Send PayPal invoice**. TeTrato writes the concept, **Confirm and send** issues the invoice through the PayPal Agent Toolkit, and the client pays it with **Pay invoice in PayPal**.

## 5. Turn a scope change into a paid addendum

1. Open **Changes** and click **Register client request**. Upload `03-change-request-store.pdf`.
2. Trato's AI compares the request with the agreement and drafts **addendum v1**: an online store with ten products. Review it, save its PDF and **Send addendum**.
3. **Act as the client.** Open the email in the inbox you used for the client and follow its link. The client portal needs no Trato account. Click **Request changes**, write `Please reduce the store to five products.` and click **Send request**.
4. Back in Trato, open the request and click **Prepare new version with TeTrato**. Review **addendum v2** and send it.
5. **Act as the client again.** Open the new email and click **Accept addendum**. Trato records which version and document were accepted, and when.
6. Click **Pay with PayPal** in the portal and approve with the Sandbox buyer account.
7. Back in Trato, the change shows as paid once the backend verifies the capture. If it has not updated yet, click **Verify payment ↻**. Once paid, the change becomes read-only. Any new adjustment is a separate request.

**If the client answers outside Trato:** under **Did the client answer another way?** you can check Gmail replies or register a document. To try it, upload `04-client-adjustments-addendum-v1.pdf` as the client's feedback or `05-client-acceptance-addendum-v2.pdf` as the received acceptance.

## 6. The client account

Sign up with the client's email address and choose **Client**. After you confirm that address, **My projects** opens each project with its **Work plan** (deliveries to approve and pay), **Agreement changes** (addenda, with the same actions as the portal) and **Disputes and problems**.

## 7. Explore the rest

- **Project map:** the agreement, requests, addenda, acceptances, delivery approvals and payments as a graph.
- **TeTrato assistant:** ask *"What is included in deliverable 2?"* or *"How much has the client paid so far?"*. Answers cite the project's own documents.
- **Rehearsals:** practice a scope-creep conversation with an AI client, then choose **End practice → Analyze with AI** for coaching with cited sources.
