-- Proposal only: explicit remote approval required.
begin;
alter table public.doctor_invitations add column sent_at timestamptz;
update public.doctor_invitations i set sent_at=(select max(a.occurred_at) from public.audit_logs a
 where a.organization_id=i.organization_id and a.entity_id=i.id and a.action='auth.invitation_sent');
create table clinic_private.invitation_dispatch (
 invitation_id uuid primary key references public.doctor_invitations(id),
 request_id uuid not null unique, attempted_at timestamptz not null,
 state text not null check(state in ('sending','sent','failed')), provider_id text
);
alter table clinic_private.invitation_dispatch enable row level security;
alter table clinic_private.invitation_dispatch force row level security;
revoke all on clinic_private.invitation_dispatch from public,anon,authenticated,service_role;
create function public.manage_doctor_invitation(p_actor uuid,p_id uuid,p_action text,p_request uuid,p_hash bytea default null,p_receipt text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.doctor_invitations; d clinic_private.invitation_dispatch; o uuid; ts timestamptz;
begin
 select * into strict i from public.doctor_invitations where id=p_id for update;
 o:=clinic_private.phase2b_admin(p_actor,i.branch_id);
 if o is distinct from i.organization_id then raise exception 'Forbidden' using errcode='42501'; end if;
 if i.status in ('accepted','revoked') or i.accepted_user_id is not null or exists(
  select 1 from clinic_private.doctor_onboarding where invitation_id=i.id and completed_at is not null
 ) then raise exception 'Invitation is closed' using errcode='42501'; end if;
 select * into d from clinic_private.invitation_dispatch where invitation_id=i.id for update;
 ts:=clock_timestamp();
 if p_action='revoke' then
  update public.doctor_invitations set status='revoked' where id=i.id;
  update clinic_private.invitation_secrets set consumed_at=ts,token_hash=decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex') where invitation_id=i.id;
 elsif p_action='rotate' then
  if p_request is null or p_hash is null or octet_length(p_hash)<>32 or (i.status='draft' and d.invitation_id is null) then
   raise exception 'Invalid rotation' using errcode='22023'; end if;
  if d.attempted_at>ts-interval '60 seconds' or (d.state='sending' and d.attempted_at>ts-interval '2 minutes') then
   raise exception 'Please wait before resending' using errcode='54000'; end if;
  if d.request_id=p_request then raise exception 'Request already used' using errcode='42501'; end if;
  perform public.phase2b_email_limit(encode(sha256(convert_to(lower(i.email),'UTF8')),'hex'));
  update clinic_private.invitation_secrets set token_hash=p_hash,consumed_at=null where invitation_id=i.id;
  if not found then raise exception 'Secret unavailable' using errcode='42501'; end if;
  update public.doctor_invitations set status='draft',expires_at=ts+interval '24 hours' where id=i.id;
  insert into clinic_private.invitation_dispatch values(i.id,p_request,ts,'sending',null)
   on conflict(invitation_id) do update set request_id=excluded.request_id,attempted_at=excluded.attempted_at,state='sending',provider_id=null;
 elsif p_action in ('sent','failed') then
  if d.invitation_id is null or p_request is null or d.request_id is distinct from p_request or d.state<>'sending' or i.status<>'draft' then
   raise exception 'Delivery lease invalid' using errcode='42501'; end if;
  if p_action='sent' then
   if p_receipt is null or length(p_receipt) not between 1 and 200 or i.expires_at<=ts then raise exception 'Invalid receipt' using errcode='22023'; end if;
   update public.doctor_invitations set status='sent',sent_at=ts where id=i.id;
  else
   update clinic_private.invitation_secrets set consumed_at=ts where invitation_id=i.id;
  end if;
  update clinic_private.invitation_dispatch set state=case when p_action='sent' then 'sent' else 'failed' end,provider_id=p_receipt where invitation_id=i.id;
 else raise exception 'Invalid action' using errcode='22023'; end if;
 insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id,occurred_at)
 values(o,i.branch_id,p_actor,'auth.invitation_management_'||p_action,'doctor_invitations',i.id,ts);
 return jsonb_build_object('id',i.id,'email',i.email);
end $$;
revoke all on function public.manage_doctor_invitation(uuid,uuid,text,uuid,bytea,text) from public,anon,authenticated;
grant execute on function public.manage_doctor_invitation(uuid,uuid,text,uuid,bytea,text) to service_role;
-- Initial delivery remains compatible; stale legacy acknowledgements cannot revive rotated proofs.
create or replace function public.phase2b_invitation_delivery(p_actor uuid,p_id uuid,p_sent boolean) returns void
language plpgsql security definer set search_path='' as $$
declare i public.doctor_invitations;
begin
 select * into strict i from public.doctor_invitations where id=p_id for update;
 perform clinic_private.phase2b_admin(p_actor,i.branch_id);
 if i.invited_by<>p_actor or i.status<>'draft' or exists(select 1 from clinic_private.invitation_dispatch where invitation_id=i.id) then
  raise exception 'Invalid delivery transition' using errcode='42501'; end if;
 update public.doctor_invitations set status=case when p_sent then 'sent'::public.invitation_status else 'revoked'::public.invitation_status end,
  sent_at=case when p_sent then clock_timestamp() else sent_at end where id=p_id;
 if not p_sent then update clinic_private.invitation_secrets set consumed_at=clock_timestamp() where invitation_id=p_id; end if;
 insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
 values(i.organization_id,i.branch_id,p_actor,case when p_sent then 'auth.invitation_sent' else 'auth.invitation_delivery_failed' end,'doctor_invitations',p_id);
end $$;
notify pgrst,'reload schema';
commit;
