-- Execute with psql -v ON_ERROR_STOP=1 as test DB owner. Everything rolls back.
begin;
set local statement_timeout='10s';
\ir fixtures/refund_fixture.sql
create temp table refund_test_fixture as select pg_temp.refund_fixture() as a,pg_temp.refund_fixture() as b;
grant select on refund_test_fixture to authenticated;
select set_config('request.jwt.claim.sub',a->>'owner',true) from refund_test_fixture;
set local role authenticated;
do $$declare f jsonb; foreign_f jsonb;result jsonb;again jsonb;edit jsonb;one jsonb;two jsonb;
 terms jsonb;parent uuid;item jsonb;bad jsonb;state text;msg text;
begin
 select a,b into f,foreign_f from refund_test_fixture;
 result:=public.refund_command('create',f->'request','create-1');parent:=(result->'settlement'->>'id')::uuid;
 again:=public.refund_command('create',f->'request','create-1');
 if result<>again then raise exception 'Create replay failed';end if;
 if (public.project_request_status((f->>'project')::uuid)->>'can_register')::boolean then raise exception 'Refund not in request gate';end if;
 if not exists(select 1 from public.refund_sources where settlement_id=parent and extraction_result_hash=repeat('c',64)) then raise exception 'Missing source snapshot';end if;
 begin perform public.refund_command('create',f->'request','create-2');raise exception 'Second request allowed';exception when sqlstate 'PT409' then if sqlerrm<>'PROJECT_HAS_OPEN_REQUEST' then raise;end if;end;
 begin perform public.refund_command('create',(f->'request')||'{"reason":"Other"}','create-1');raise exception 'Key reuse allowed';exception when sqlstate 'PT409' then if sqlerrm<>'IDEMPOTENCY_KEY_CONFLICT' then raise;end if;end;
 begin perform public.refund_command('create',foreign_f->'request','foreign');raise exception 'Foreign project allowed';exception when sqlstate 'PT404' then null;end;
 begin perform public.reserve_document((f->>'project')::uuid,'Other request','email_request','request.pdf','application/pdf',10,repeat('e',64),'race-request');raise exception 'Change bypassed refund gate';exception when sqlstate 'PT409' then if sqlerrm<>'PROJECT_HAS_OPEN_REQUEST' then raise;end if;end;
 terms:=jsonb_build_object('currency','USD','conditions','Closure','adjustments','[]'::jsonb,'proposed_refund_minor',30000);
 edit:=jsonb_build_object('settlement_id',parent,'expected_snapshot_id',null,'terms',terms);
 one:=public.refund_command('edit_draft',edit,'draft-1');
 if (one->'snapshot'->'breakdown'->>'provider_verified')::boolean or one->'snapshot'->'breakdown'->'original_fee_minor'<>'null'::jsonb then raise exception 'Fabricated financial context';end if;
 if public.refund_command('edit_draft',edit,'draft-1')<>one then raise exception 'Draft replay failed';end if;
 begin perform public.refund_command('edit_draft',edit,'stale');raise exception 'Stale edit allowed';exception when sqlstate 'PT409' then if sqlerrm<>'REFUND_REVISION_CONFLICT' then raise;end if;end;
 edit:=edit||jsonb_build_object('expected_snapshot_id',one->'snapshot'->>'id');
 item:=jsonb_build_object('concept_id',gen_random_uuid(),'kind','penalty','beneficiary','seller','description','Cancellation clause',
  'amount_minor',3000,'evidence',jsonb_build_array(jsonb_build_object('document_id',f->>'document','extraction_id',f->>'extraction','document_sha256',repeat('a',64),'quote','Cancellation fee: USD 30.')));
 edit:=jsonb_set(edit,'{terms,adjustments}',jsonb_build_array(item));edit:=jsonb_set(edit,'{terms,proposed_refund_minor}','27000');
 -- Direct RPC must reject invalid money, extra keys, wrong evidence and duplicate concepts.
 foreach bad in array array[
  jsonb_set(edit,'{terms,proposed_refund_minor}','true'),
  jsonb_set(edit,'{terms,proposed_refund_minor}','"27000"'),
  jsonb_set(edit,'{terms,proposed_refund_minor}','-1'),
  jsonb_set(edit,'{terms,adjustments}',jsonb_build_array(item,item)),
  jsonb_set(edit,'{terms,adjustments,0,evidence}','[]'),
  jsonb_set(edit,'{terms,adjustments,0,evidence,0,quote}','"Invented"'),
  jsonb_set(edit,'{terms,adjustments,0,evidence,0,quote}','" Cancellation fee: USD 30. "'),
  jsonb_set(edit,'{terms,adjustments,0,evidence,0,document_id}',foreign_f->'document'),
  jsonb_set(edit,'{terms,adjustments,0,evidence,0,extraction_id}',to_jsonb(gen_random_uuid()::text)),
  jsonb_set(edit,'{terms,adjustments,0,percentage}','{"base_minor":100,"basis_points":5000}'),
  jsonb_set(edit,'{terms,adjustments,0,beneficiary}','"unknown"'),
  jsonb_set(edit,'{terms,currency}','"EUR"'),
  edit||'{"provider_verified":true}',
  jsonb_set(edit,'{terms,conditions}','null')
 ] loop
  begin perform public.refund_command('edit_draft',bad,'bad-'||gen_random_uuid()::text);raise exception 'Bad draft accepted';
  exception when sqlstate 'PT422' or sqlstate 'PT409' then null;end;
 end loop;
 two:=public.refund_command('edit_draft',edit,'draft-2');
 if (two->'snapshot'->>'version_no')::int<>1 or (two->'snapshot'->>'draft_sequence')::int<>2 then raise exception 'Wrong draft numbering';end if;
 if not exists(select 1 from public.refund_snapshots s where s.id=(one->'snapshot'->>'id')::uuid and s.terms=one->'snapshot'->'terms') then raise exception 'Old draft overwritten';end if;
 begin update public.refund_snapshots set terms='{}' where settlement_id=parent;raise exception 'Direct write allowed';exception when insufficient_privilege then null;end;
 begin delete from public.refund_settlements where id=parent;raise exception 'Direct delete allowed';exception when insufficient_privilege then null;end;
 begin perform public.refund_command('accept',jsonb_build_object('settlement_id',parent),'accept');raise exception 'Acceptance forged';exception when sqlstate 'PT422' then null;end;
 again:=public.refund_command('close',jsonb_build_object('settlement_id',parent,'reason','withdrawn','notes','Customer withdrew'),'close-1');
 if public.refund_command('close',jsonb_build_object('settlement_id',parent,'reason','withdrawn','notes','Customer withdrew'),'close-1')<>again then raise exception 'Close replay failed';end if;
 if not (public.project_request_status((f->>'project')::uuid)->>'can_register')::boolean then raise exception 'Closed request did not release gate';end if;
 begin perform public.refund_command('edit_draft',edit,'after-close');raise exception 'Closed request editable';exception when sqlstate 'PT409' then if sqlerrm<>'REFUND_SETTLEMENT_READ_ONLY' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',foreign_f->>'owner',true);
 if exists(select 1 from public.refund_settlements where id=parent) or exists(select 1 from public.refund_snapshots where settlement_id=parent)
 or exists(select 1 from public.refund_sources where settlement_id=parent) or exists(select 1 from public.refund_events where settlement_id=parent)
 then raise exception 'RLS leaked refund data';end if;
 begin perform public.refund_command('edit_draft',edit,'foreign-edit');raise exception 'Foreign edit allowed';exception when sqlstate 'PT404' then null;end;
end $$;
reset role;
do $$declare f jsonb;begin
 select a into f from refund_test_fixture;
 if has_function_privilege('anon','public.refund_command(text,jsonb,text)','execute')
 or has_function_privilege('authenticated','private.refund_prepare(jsonb,bigint,bigint,uuid,uuid)','execute')
 then raise exception 'Helper privilege exposed';end if;
 if not exists(select 1 from public.proposal_payments where id=(f->>'payment')::uuid and status='completed') then raise exception 'Original payment changed';end if;
 begin update public.refund_snapshots set terms='{}';raise exception 'History mutable';exception when sqlstate 'PT409' then null;end;
 update public.projects set deleted_at=now() where id=(f->>'project')::uuid;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',a->>'owner',true) from refund_test_fixture;
do $$begin
 if exists(select 1 from public.refund_settlements) or exists(select 1 from public.refund_snapshots)
 then raise exception 'Deleted project refunds visible';end if;
end $$;
reset role;
-- Additional backend checks use new synthetic fixtures, still inside rollback.
do $$declare f jsonb;result jsonb;parent uuid;begin
 f:=pg_temp.refund_fixture();perform set_config('request.jwt.claim.sub',f->>'owner',true);
 update public.proposal_payments set status='pending' where id=(f->>'payment')::uuid;
 begin perform public.refund_command('create',f->'request','not-paid');raise exception 'Unpaid capture allowed';exception when sqlstate 'PT409' then if sqlerrm<>'REFUND_PAYMENT_NOT_ELIGIBLE' then raise;end if;end;
 update public.proposal_payments set status='completed' where id=(f->>'payment')::uuid;
 update public.document_extractions set status='queued' where id=(f->>'extraction')::uuid;
 begin perform public.refund_command('create',f->'request','unready');raise exception 'Unready source allowed';exception when sqlstate 'PT409' then if sqlerrm<>'REFUND_EVIDENCE_MISMATCH' then raise;end if;end;
 update public.document_extractions set status='ready' where id=(f->>'extraction')::uuid;
 result:=public.refund_command('create',f->'request','ready');parent:=(result->'settlement'->>'id')::uuid;
 update public.refund_settlements set status='accepted' where id=parent;
 begin perform public.refund_command('close',jsonb_build_object('settlement_id',parent,'reason','withdrawn','notes','Do not revoke acceptance'),'accepted-close');raise exception 'Acceptance revoked';exception when sqlstate 'PT409' then if sqlerrm<>'REFUND_SETTLEMENT_READ_ONLY' then raise;end if;end;
end $$;
rollback;
