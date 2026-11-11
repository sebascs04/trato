# Café Aurora: a hands-on guide to Trato

Café Aurora, a small coffee shop, hires Alex Vega to build its website for USD 600 in three paid stages. Along the way, the owner, Lucy Rivers, asks for an online store, approves each delivery and, near the end, asks for part of a payment back. This folder holds every document of that story, so you can live it in Trato from the freelancer's side and from the client's side, in about 15 minutes.

Everything is fictional and runs on PayPal Sandbox, so no real money moves.

> **You are reading the user manual.** The sample PDFs live in six folders right next to this file. To see them, go back to the folder [trato/examples/cafe-aurora](https://github.com/sebascs04/trato/tree/main/examples/cafe-aurora), download the files of the step you are on, and then return here to follow it. Each step below also links straight to its folder.

## Before you start

You need three things:

1. **The Trato login** from the Devpost submission. Open the demo at https://trato-web-68896425401.us-central1.run.app and sign in. If the interface appears in Spanish, switch it in **Profile → Language → English**.
2. **The PayPal Sandbox buyer account** from the Devpost submission. You use it whenever you pay as the client.
3. **The sample PDFs**, in the six folders of [trato/examples/cafe-aurora](https://github.com/sebascs04/trato/tree/main/examples/cafe-aurora). Each folder covers one situation and has a short note of its own; download its files before you start that step.

| Folder | Situation | Step |
| --- | --- | --- |
| [`1-new-project`](1-new-project) | Start a project from the client's first message | [3](#3-start-a-new-project) |
| [`2-get-paid-per-deliverable`](2-get-paid-per-deliverable) | Deliver, get approved and get paid, stage by stage | [4](#4-get-paid-for-each-deliverable) |
| [`3-change-and-addendum`](3-change-and-addendum) | Turn the store request into a paid addendum | [5](#5-turn-a-change-into-a-paid-addendum) |
| [`4-project-already-started`](4-project-already-started) | Bring in work that began outside Trato | [6](#6-bring-in-a-project-that-already-started) |
| [`5-refund`](5-refund) | Return part of a payment | [7](#7-refund-part-of-a-payment) |
| [`6-dispute`](6-dispute) | Answer a PayPal dispute with TeTrato | [8](#8-answer-a-paypal-dispute) |

## 1. Look at the finished example

Your judge account already holds this same story, finished, so you can see where it leads before you build it yourself. Open **Clients → Café Aurora (example) → Café Aurora website (completed example)**. There, the **Work plan** shows the three deliverables paid, **Changes** shows the store addendum, **Disputes & problems** shows a PayPal dispute with TeTrato's prepared response, and **Project history** shows every step in order.

## 2. Create the client

Every project belongs to a client, so the story starts there. Go to **Clients → New client** and fill in:

- **Name:** `Café Aurora`
- **Contact email:** an inbox you can open. Trato sends the addendum and payment emails there, and you will use it to act as Lucy.

## 3. Start a new project

**Files:** [`1-new-project`](1-new-project)

Lucy's first message describes the website, and TeTrato turns it into a plan.

1. Open the client and click **New project**, then choose **I'm about to start a project → Prepare the work plan**.
2. Fill in the project:
   - **Name:** `Café Aurora website`
   - **What the client asked for:** copy this text:
     > Design and development of a responsive five-section website in English for Café Aurora: Home, Menu, About us, Gallery and Contact. Includes an inquiry form, two rounds of revisions and launch. The client provides copy, photos and logo. Budget: USD 600. Delivery: November 20, 2026. Payments agreed with the client, each after its deliverable is approved: USD 180 for planning and initial UI design, USD 300 for website development and USD 120 for testing and launch.
   - **Project amount · USD:** `600`, with **November 20, 2026** as the delivery date.
3. Upload `1-new-project/01-initial-conversation.pdf` as the starting document and click **Organize with AI**. TeTrato reads it and proposes three deliverables with their payments: USD 180, USD 300 and USD 120. **Reasoning behind the AI proposal** shows the passages it used.
4. Review the plan, adjust any stage you like, and click **Create project**.
5. Trato then asks for the initial agreement. Click **Continue with the initial agreement**, upload `1-new-project/02-initial-agreement.pdf`, check **I confirm that this reflects the agreement with the client** and save it. From now on, every request is compared with this agreement.

## 4. Get paid for each deliverable

**Files:** [`2-get-paid-per-deliverable`](2-get-paid-per-deliverable)

Each stage follows the same three moves: Alex delivers, Lucy approves, PayPal pays. Repeat them for deliverables 1, 2 and 3, in order.

1. **Deliver.** In the project, open **Work plan**, click the deliverable and choose **Delivery and payment**. Attach its file from `2-get-paid-per-deliverable/` (for example, `deliverable-1-acknowledgment.pdf` for the first stage) and click **Send to client for review**.
2. **Approve as Lucy.** The first time, sign up in Trato with the client's email and choose **Client**. Then open **My projects → Café Aurora website → Work plan**, open the deliverable, click **View delivery** and then **Approve delivery**.
3. **Request the payment.** Back as Alex, open **Delivery and payment** again and click **Send payment request**. Trato prepares the PayPal order and emails it to Lucy in the same step.
4. **Pay as Lucy.** In Lucy's **Work plan**, the deliverable now shows PayPal's own payment buttons. Pay with the Sandbox buyer account, and the stage changes to **Paid** as soon as Trato's backend verifies the capture with PayPal.

To collect a stage with an invoice instead, click **Send PayPal invoice** under **Delivery and payment**. TeTrato writes the invoice concept, **Confirm and send** issues it through the PayPal Agent Toolkit, and Lucy pays it with **Pay invoice in PayPal**.

## 5. Turn a change into a paid addendum

**Files:** [`3-change-and-addendum`](3-change-and-addendum)

Halfway through, Lucy asks for an online store. Trato turns that request into a new paid agreement instead of free extra work.

1. Open **Changes**, click **Register client request** and upload `3-change-and-addendum/01-change-request-store.pdf`.
2. Click **Prepare proposal**. TeTrato compares the request with the agreement, shows the clause that leaves the store out and drafts **addendum v1**: a store with ten products. Set your rate, review the addendum and click **Send addendum**.
3. **Act as Lucy.** Open the email in the client's inbox and follow its link to the client portal, which needs no account. Click **Request changes**, write `Please reduce the store to five products.` and send it.
4. Back as Alex, open the request and click **Prepare new version with TeTrato**. Review **addendum v2** and send it.
5. **Act as Lucy again.** Open the new email, click **Accept addendum** and then **Pay with PayPal**. In the portal, Lucy can also ask **Ask TeTrato** to accept or pay it for her, always with her confirmation.

When the client answers by email instead of the portal, Alex registers that answer under **Did the client answer another way?**: upload `3-change-and-addendum/02-client-adjustments-addendum-v1.pdf` as the client's feedback or `3-change-and-addendum/03-client-acceptance-addendum-v2.pdf` as the received acceptance.

## 6. Bring in a project that already started

**Files:** [`4-project-already-started`](4-project-already-started)

Many freelancers arrive at Trato with work already in progress. In this version of the story, Alex and Lucy finished and paid the first stage before using Trato, so TeTrato plans only what is left.

1. Open the client, click **New project** and choose **The project is already underway → Record the initial agreement**.
2. In **Upload what you have already agreed**, add the three files from `4-project-already-started/` and choose each one's type:
   - `01-initial-agreement.pdf` as **Initial agreement**
   - `02-deliverable-1-acknowledgment.pdf` as **Delivery or acceptance**
   - `03-project-status-before-trato.pdf` as **Reference**
3. Click **Review and create**, then **Create project**.
4. In the new project, open **Work plan** and click **Prepare the plan with TeTrato**. TeTrato reads the documents, recognizes that stage 1 is done and paid, and proposes the two remaining stages for USD 420. Click **Confirm and save**, and the project continues exactly like step 4.

## 7. Refund part of a payment

**Files:** [`5-refund`](5-refund)

After paying the store addendum, Lucy no longer needs two product pages and asks for USD 40 back. Trato handles it from either side.

**When Lucy asks from her account:**

1. As Lucy, open the paid store addendum, click **Request a refund**, enter `40` and the reason, and send it.
2. As Alex, open **Refunds**. The request appears with Lucy's message; click **Review step by step**. Trato fills in the amount Lucy asked for and attaches her request as the proof.
3. Click **Register refund request**, then **Refund $40.00**. A PayPal window asks for confirmation and, a moment later, shows that PayPal returned the money to the original payment.

**When Alex registers it himself:** open **Refunds → Register refund request**, choose the store payment, enter `40` and the reason, attach `5-refund/client-refund-request-email.pdf` as the proof, and continue from the third move above.

## 8. Answer a PayPal dispute

**Files:** [`6-dispute`](6-dispute)

A dispute needs no new file, because TeTrato answers with the records the project already has: the stage's terms, the delivered file, the client's approval and the PayPal payment.

1. Pay any deliverable or addendum as Lucy.
2. As the buyer, open a dispute on that payment at https://www.sandbox.paypal.com/resolutioncenter with **Report a Problem**.
3. A few minutes later, Trato's home page shows **A client opened a PayPal dispute**. Open it and click **Prepare response with TeTrato**. TeTrato rates the evidence, cites each record and drafts the message, which you review before **Send to client**.

## 9. Explore the rest

- **Project history and map:** every request, addendum, approval, payment and dispute, as a timeline and as a graph.
- **TeTrato for Alex:** ask *"What is included in deliverable 2?"* and the answer cites the project's own documents.
- **TeTrato for Lucy:** in her account, the corner button answers *"How much have I paid?"* from her records.
- **Rehearsals:** practice a scope-creep conversation with an AI client, then choose **End practice → Analyze with AI** for coaching with sources.
