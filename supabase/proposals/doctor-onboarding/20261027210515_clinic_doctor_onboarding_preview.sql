-- Service-only invitation bearer validation; separate approval required before remote apply.
begin;
create function public.phase2b_invitation_preview(p_id uuid,p_hash bytea,p_user uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.doctor_invitations; did uuid;
begin
 select * into i from public.doctor_invitations where id=p_id;
 if not found or octet_length(p_hash)<>32 or i.expires_at<=clock_timestamp() or not exists(
   select 1 from clinic_private.invitation_secrets s where s.invitation_id=i.id and s.token_hash=p_hash
     and ((i.status='sent' and s.consumed_at is null) or
       (i.status='accepted' and i.accepted_user_id=p_user and s.consumed_at is not null))
 ) then raise exception 'Invalid invitation' using errcode='42501'; end if;
 perform clinic_private.phase2b_admin(i.invited_by,i.branch_id);
 if i.status='accepted' then
   if lower(clinic_private.phase2b_verified_email(p_user))<>lower(i.email) then raise exception 'Identity mismatch' using errcode='42501'; end if;
   select id into strict did from public.doctors where organization_id=i.organization_id and user_id=p_user and active;
 end if;
 return jsonb_build_object('id',i.id,'name',i.name,'email',i.email,'organizationId',i.organization_id,
   'branchId',i.branch_id,'branch',(select name from public.branches where id=i.branch_id),
   'specializationId',i.specialization_id,'specialization',(select name from public.specializations where id=i.specialization_id and organization_id=i.organization_id),
   'doctorId',did,'accepted',i.status='accepted');
end $$;
revoke all on function public.phase2b_invitation_preview(uuid,bytea,uuid) from public,anon,authenticated;
grant execute on function public.phase2b_invitation_preview(uuid,bytea,uuid) to service_role;
notify pgrst,'reload schema';
commit;
