begin;
alter table public.document_upload_contexts add constraint document_upload_context_domain check (
 (purpose='initial_agreement' and request_document_id is null and revision_id is null and refund_case_id is null and payment_id is null)
 or (purpose='change_request' and request_document_id=document_id and revision_id is null and refund_case_id is null and payment_id is null)
 or (purpose in('addendum_adjustments','acceptance_evidence','generated_addendum') and request_document_id is not null and revision_id is not null and refund_case_id is null and payment_id is null)
 or (purpose in('refund_request','refund_evidence') and request_document_id is null and revision_id is null)
 or (purpose in('supporting_reference','delivery_evidence') and revision_id is null and refund_case_id is null and payment_id is null)
);
commit;
