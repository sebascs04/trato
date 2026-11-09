begin;

create table private.refund_confirmation_mail (
    settlement_id uuid primary key references public.refund_settlements(id),
    owner_id uuid not null,
    recipient text not null,
    project_name text not null,
    language text not null check (language in ('es','en')),
    amount_minor bigint not null check (amount_minor > 0),
    status text not null default 'pending' check (status in ('pending','sending','accepted_by_gmail','failed','delivery_uncertain')),
    automatic boolean not null,
    claim_id uuid,
    message_id text,
    error_code text
);

-- Historical confirmations are visible for explicit sending, never dispatched in bulk.
create function private.refund_confirmation_candidates(p_settlement uuid)
returns table(settlement_id uuid,owner_id uuid,recipient text,project_name text,language text,amount_minor bigint)
language sql stable set search_path='' as $$
    select s.id,s.owner_id,d.recipient,a.render_context->>'project_name',a.language,s.confirmed_refund_minor
    from public.refund_settlements s
    join public.projects p on p.id=s.project_id and p.owner_id=s.owner_id and p.deleted_at is null
    join public.clients c on c.id=p.client_id and c.owner_id=s.owner_id and c.deleted_at is null
    join public.refund_deliveries d on d.settlement_id=s.id and d.owner_id=s.owner_id
        and d.snapshot_id=s.current_snapshot_id and d.status='accepted_by_gmail'
    join public.refund_artifacts a on a.id=d.artifact_id
    where (p_settlement is null or s.id=p_settlement)
      and s.status='completed' and s.confirmed_refund_minor>0 and a.render_context->>'project_name' is not null
      and s.confirmed_refund_minor=(
          select sum(r.amount_minor)
          from public.refund_receipt_applications x
          join public.refund_provider_receipts r on r.id=x.receipt_id and r.status='completed'
          where x.settlement_id=s.id and x.owner_id=s.owner_id
      );
$$;

insert into private.refund_confirmation_mail(settlement_id,owner_id,recipient,project_name,language,amount_minor,automatic)
select candidates.*,false from private.refund_confirmation_candidates(null) candidates;

create function private.queue_refund_confirmation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
    insert into private.refund_confirmation_mail(settlement_id,owner_id,recipient,project_name,language,amount_minor,automatic)
    select candidates.*,true from private.refund_confirmation_candidates(new.id) candidates
    on conflict (settlement_id) do nothing;
    return new;
end $$;

create trigger queue_refund_confirmation after update of status on public.refund_settlements
for each row when (old.status is distinct from new.status and new.status='completed' and new.confirmed_refund_minor>0)
execute function private.queue_refund_confirmation();

create function public.refund_confirmation_claim(p_owner uuid,p_settlement uuid,p_payment uuid,p_retry boolean)
returns jsonb language sql security definer set search_path='' as $$
    with candidate as (
        select m.settlement_id from private.refund_confirmation_mail m
        where m.owner_id=p_owner
          and exists (
              select 1 from public.refund_settlements s
              join public.projects p on p.id=s.project_id and p.owner_id=s.owner_id and p.deleted_at is null
              join public.clients c on c.id=p.client_id and c.owner_id=s.owner_id and c.deleted_at is null
              where s.id=m.settlement_id and s.owner_id=m.owner_id and s.status='completed')
          and ((m.status='pending' and m.automatic) or (m.status in ('pending','failed') and p_retry and p_settlement is not null))
          and (m.settlement_id=p_settlement or (p_settlement is null and exists(
              select 1 from public.refund_settlement_payments x
              where x.settlement_id=m.settlement_id and x.payment_id=p_payment)))
        order by m.settlement_id limit 1 for update of m skip locked
    ), claimed as (
        update private.refund_confirmation_mail m set status='sending',claim_id=gen_random_uuid(),error_code=null
        from candidate c where c.settlement_id=m.settlement_id returning m.*
    )
    select to_jsonb(claimed) from claimed;
$$;

create function public.refund_confirmation_finish(p_owner uuid,p_settlement uuid,p_claim uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare mail_status text := p_result->>'status';
begin
    if mail_status not in ('accepted_by_gmail','failed','delivery_uncertain') or mail_status is null
       or (mail_status='accepted_by_gmail' and nullif(p_result->>'message_id','') is null) then
        raise sqlstate 'PT422' using message='INVALID_REFUND_CONFIRMATION_RESULT';
    end if;
    update private.refund_confirmation_mail
    set status=mail_status,message_id=p_result->>'message_id',error_code=p_result->>'error_code',claim_id=null
    where settlement_id=p_settlement and owner_id=p_owner and claim_id=p_claim and status='sending';
    if not found then raise sqlstate 'PT409' using message='REFUND_CONFIRMATION_CONFLICT';end if;
    return jsonb_build_object('status',mail_status);
end $$;

alter function private.refund_financial_view(uuid,uuid) rename to refund_financial_view_before_confirmation;
create function private.refund_financial_view(p_owner uuid,p_parent uuid) returns jsonb
language sql stable security definer set search_path='' as $$
    select private.refund_financial_view_before_confirmation(p_owner,p_parent)||jsonb_build_object(
        'confirmation_email', (select jsonb_build_object('status',m.status,'error_code',m.error_code)
        from private.refund_confirmation_mail m where m.settlement_id=p_parent and m.owner_id=p_owner));
$$;

revoke all on private.refund_confirmation_mail from public,anon,authenticated,service_role;
revoke all on function private.refund_confirmation_candidates(uuid),private.queue_refund_confirmation(),private.refund_financial_view(uuid,uuid),
public.refund_confirmation_claim(uuid,uuid,uuid,boolean),public.refund_confirmation_finish(uuid,uuid,uuid,jsonb)
from public,anon,authenticated,service_role;
grant execute on function public.refund_confirmation_claim(uuid,uuid,uuid,boolean),
public.refund_confirmation_finish(uuid,uuid,uuid,jsonb) to service_role;
commit;
