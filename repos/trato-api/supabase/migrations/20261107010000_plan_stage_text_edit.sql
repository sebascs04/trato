-- 7 Nov 2026: a saved plan can correct the wording of a deliverable that has not started.
-- Amounts, percentages and positions are not editable here; changes to agreed work go through an addendum.
-- A stage is "started" once it has a stage checkout or delivery evidence; paid or started stages stay read-only.
begin;
create function private.edit_plan_stage(p_project uuid,p_position integer,p_title text,p_deliverables text,p_payment_condition text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.project_start_stages;
begin
 if u is null then raise sqlstate 'PT401' using message='UNAUTHORIZED';end if;
 if length(trim(coalesce(p_title,''))) not between 1 and 200
  or length(trim(coalesce(p_deliverables,''))) not between 1 and 2000
  or length(trim(coalesce(p_payment_condition,''))) not between 1 and 500 then raise sqlstate 'PT422' using message='PLAN_STAGE_INVALID';end if;
 perform private.ensure_active_project(p_project,u);
 perform 1 from public.projects where id=p_project and owner_id=u for update;
 select * into s from public.project_start_stages where project_id=p_project and owner_id=u and position=p_position;
 if not found then raise sqlstate 'PT404' using message='PLAN_STAGE_NOT_FOUND';end if;
 if exists(select 1 from public.project_start_plans where project_id=p_project and owner_id=u and completed_at is not null)
  or exists(select 1 from public.project_initial_checkouts where project_id=p_project and stage_position=p_position)
  or exists(select 1 from public.document_upload_contexts where project_id=p_project and stage_position=p_position and purpose='delivery_evidence')
 then raise sqlstate 'PT409' using message='PLAN_STAGE_STARTED';end if;
 update public.project_start_stages set title=trim(p_title),deliverables=trim(p_deliverables),payment_condition=trim(p_payment_condition)
  where project_id=p_project and owner_id=u and position=p_position returning * into s;
 return jsonb_build_object('position',s.position,'title',s.title,'deliverables',s.deliverables,'payment_condition',s.payment_condition,'percent',s.percent,'amount',s.amount);
end $$;
revoke all on function private.edit_plan_stage(uuid,integer,text,text,text) from public,anon;
grant execute on function private.edit_plan_stage(uuid,integer,text,text,text) to authenticated;
create function public.edit_plan_stage(p_project uuid,p_position integer,p_title text,p_deliverables text,p_payment_condition text) returns jsonb language sql security invoker set search_path='' as $$select private.edit_plan_stage(p_project,p_position,p_title,p_deliverables,p_payment_condition)$$;
revoke all on function public.edit_plan_stage(uuid,integer,text,text,text) from public,anon;
grant execute on function public.edit_plan_stage(uuid,integer,text,text,text) to authenticated;
commit;
