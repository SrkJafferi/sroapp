-- Candidate only: explicit approval is required before remote application.
-- Existing clinical tables, signed records, policies and migrations are not altered.
begin;
do $$ begin
  if current_setting('server_version_num')::int/10000<>17 then raise exception 'PostgreSQL 17 required'; end if;
  if to_regprocedure('clinic_private.phase2b_assurance()') is null then raise exception 'Reviewed Auth migration required'; end if;
  if exists(select 1 from storage.buckets where id='clinic-medical-documents') then raise exception 'Bucket already exists: inspect configuration before deployment'; end if;
  if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then raise exception 'Storage objects RLS required'; end if;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('clinic-medical-documents','clinic-medical-documents',false,10485760,array['application/pdf','image/jpeg','image/png']);

create table clinic_private.document_uploads (
  id uuid primary key default gen_random_uuid(), request_id uuid not null,
  document_id uuid not null unique default gen_random_uuid(), organization_id uuid not null,
  patient_id uuid not null,branch_id uuid not null,author_id uuid not null,
  kind text not null check(kind in ('report','handwritten')),
  name text not null check(length(name) between 1 and 250),
  mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes bigint not null check(size_bytes between 1 and 10485760),
  object_key text not null unique,
  state text not null default 'pending' check(state in ('pending','validated','completed','abandoned')),
  object_id uuid,object_version text,sha256 text check(sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '20 minutes',
  validated_at timestamptz,completed_at timestamptz,
  unique(author_id,request_id),
  foreign key(organization_id,patient_id,branch_id) references public.patient_branches,
  foreign key(organization_id,author_id) references public.organization_memberships,
  check(state not in ('validated','completed') or (object_id is not null and object_version is not null and sha256 is not null and validated_at is not null))
);
alter table clinic_private.document_uploads enable row level security;
alter table clinic_private.document_uploads force row level security;
revoke all on clinic_private.document_uploads from public,anon,authenticated,service_role;
create index document_upload_author_state on clinic_private.document_uploads(author_id,state,expires_at);

create function clinic_private.document_upload_allowed(p_key text,p_mode text) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from clinic_private.document_uploads u
    where u.object_key=p_key and u.author_id=auth.uid()
      and clinic_private.branch_role(u.organization_id,u.branch_id,array['doctor']::public.clinic_role[])
      and clinic_private.care_access(u.organization_id,u.patient_id,u.branch_id,true)
      and case p_mode
        when 'insert' then u.state='pending' and u.expires_at>clock_timestamp()
        when 'read' then u.state in ('pending','validated','abandoned')
        when 'delete' then u.state='abandoned'
        else false end)
$$;

create function clinic_private.begin_medical_document_upload(p_patient_id uuid,p_branch_id uuid,p_request_id uuid,p_kind text,p_name text,p_mime_type text,p_size_bytes bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid;u clinic_private.document_uploads;doc uuid:=gen_random_uuid();ext text;
begin
  select organization_id into strict o from public.patients where id=p_patient_id for update;
  if not clinic_private.branch_role(o,p_branch_id,array['doctor']::public.clinic_role[])
    or not clinic_private.care_access(o,p_patient_id,p_branch_id,true) then raise exception 'Treating Doctor required' using errcode='42501'; end if;
  if p_request_id is null or p_kind not in ('report','handwritten') or p_size_bytes not between 1 and 10485760
    or p_name is null or length(p_name) not between 1 and 250 or p_name ~ '[\\/[:cntrl:]]'
    or p_mime_type not in ('application/pdf','image/jpeg','image/png')
    or not ((p_mime_type='application/pdf' and lower(p_name) like '%.pdf')
      or (p_mime_type='image/jpeg' and lower(p_name) ~ '\.(jpg|jpeg)$')
      or (p_mime_type='image/png' and lower(p_name) like '%.png')) then raise exception 'Invalid document metadata' using errcode='22023'; end if;
  select * into u from clinic_private.document_uploads where author_id=auth.uid() and request_id=p_request_id for update;
  if found then
    if (u.organization_id,u.patient_id,u.branch_id,u.kind,u.name,u.mime_type,u.size_bytes) is distinct from (o,p_patient_id,p_branch_id,p_kind,p_name,p_mime_type,p_size_bytes)
      then raise exception 'Upload request was reused for a different file' using errcode='23505'; end if;
    if u.state='abandoned' or (u.state='pending' and u.expires_at<=clock_timestamp()) then raise exception 'Select the file again to start a new upload' using errcode='23514'; end if;
  else
    if (select count(*) from clinic_private.document_uploads where author_id=auth.uid() and state in ('pending','validated') and created_at>clock_timestamp()-interval '1 hour')>=5
      then raise exception 'Resolve pending uploads before starting another' using errcode='54000'; end if;
    ext:=case p_mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' else 'png' end;
    insert into clinic_private.document_uploads(request_id,document_id,organization_id,patient_id,branch_id,author_id,kind,name,mime_type,size_bytes,object_key)
      values(p_request_id,doc,o,p_patient_id,p_branch_id,auth.uid(),p_kind,p_name,p_mime_type,p_size_bytes,o||'/'||p_branch_id||'/'||p_patient_id||'/'||doc||'.'||ext) returning * into u;
  end if;
  return jsonb_build_object('id',u.id,'documentId',u.document_id,'objectKey',u.object_key,'state',u.state,'sha256',u.sha256);
end $$;

-- Trusted server attests an immutable object version ONLY after downloading and validating its bytes.
-- This function cannot read/write clinical tables. It cannot assign identity, roles, or care access.
create function clinic_private.attest_medical_document_upload(p_upload_id uuid,p_author_id uuid,p_object_id uuid,p_object_version text,p_sha256 text)
returns void language plpgsql security definer set search_path='' as $$
declare u clinic_private.document_uploads;s storage.objects;
begin
  select * into strict u from clinic_private.document_uploads where id=p_upload_id and author_id=p_author_id for update;
  if u.state<>'pending' or u.expires_at<=clock_timestamp() or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Upload cannot be validated' using errcode='23514'; end if;
  select * into strict s from storage.objects where bucket_id='clinic-medical-documents' and name=u.object_key for update;
  if s.id is distinct from p_object_id or s.version is distinct from p_object_version
    or s.owner_id is distinct from p_author_id::text or (s.metadata->>'size')::bigint is distinct from u.size_bytes
    or s.metadata->>'mimetype' is distinct from u.mime_type then raise exception 'Stored object changed or metadata differs' using errcode='23514'; end if;
  update clinic_private.document_uploads set state='validated',object_id=s.id,object_version=s.version,sha256=p_sha256,validated_at=clock_timestamp() where id=u.id;
end $$;

create function clinic_private.complete_medical_document_upload(p_upload_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare u clinic_private.document_uploads;s storage.objects;
begin
  select * into strict u from clinic_private.document_uploads where id=p_upload_id and author_id=auth.uid() for update;
  perform 1 from public.patients where organization_id=u.organization_id and id=u.patient_id for update;
  perform 1 from public.branches where organization_id=u.organization_id and id=u.branch_id and active for share;
  if not found or not clinic_private.branch_role(u.organization_id,u.branch_id,array['doctor']::public.clinic_role[])
    or not clinic_private.care_access(u.organization_id,u.patient_id,u.branch_id,true) then raise exception 'Treating Doctor required' using errcode='42501'; end if;
  if u.state='completed' then return u.document_id; end if;
  if u.state<>'validated' then raise exception 'Stored bytes require trusted validation' using errcode='23514'; end if;
  select * into strict s from storage.objects where bucket_id='clinic-medical-documents' and name=u.object_key for update;
  if s.id is distinct from u.object_id or s.version is distinct from u.object_version or (s.metadata->>'size')::bigint is distinct from u.size_bytes
    then raise exception 'Validated object is no longer present' using errcode='23514'; end if;
  insert into public.medical_documents(id,organization_id,patient_id,branch_id,author_id,kind,name,mime_type,size_bytes,storage_object_key)
    values(u.document_id,u.organization_id,u.patient_id,u.branch_id,u.author_id,u.kind,u.name,u.mime_type,u.size_bytes,u.object_key);
  update clinic_private.document_uploads set state='completed',completed_at=clock_timestamp() where id=u.id;
  insert into public.audit_logs(organization_id,branch_id,actor_id,action,entity_type,entity_id)
    values(u.organization_id,u.branch_id,auth.uid(),'medical_document.uploaded','medical_documents',u.document_id);
  return u.document_id;
end $$;

create function clinic_private.abandon_medical_document_upload(p_upload_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u clinic_private.document_uploads;
begin
  select * into strict u from clinic_private.document_uploads where id=p_upload_id and author_id=auth.uid() for update;
  if not clinic_private.branch_role(u.organization_id,u.branch_id,array['doctor']::public.clinic_role[]) then raise exception 'Doctor required' using errcode='42501'; end if;
  if u.state not in ('pending','abandoned') then raise exception 'Validated/completed uploads cannot be discarded' using errcode='23514'; end if;
  update clinic_private.document_uploads set state='abandoned' where id=u.id;
end $$;

create function public.begin_medical_document_upload(p_patient_id uuid,p_branch_id uuid,p_request_id uuid,p_kind text,p_name text,p_mime_type text,p_size_bytes bigint) returns jsonb
language sql security invoker set search_path='' as $$select clinic_private.begin_medical_document_upload(p_patient_id,p_branch_id,p_request_id,p_kind,p_name,p_mime_type,p_size_bytes)$$;
create function public.complete_medical_document_upload(p_upload_id uuid) returns uuid
language sql security invoker set search_path='' as $$select clinic_private.complete_medical_document_upload(p_upload_id)$$;
create function public.abandon_medical_document_upload(p_upload_id uuid) returns void
language sql security invoker set search_path='' as $$select clinic_private.abandon_medical_document_upload(p_upload_id)$$;
create function public.attest_medical_document_upload(p_upload_id uuid,p_author_id uuid,p_object_id uuid,p_object_version text,p_sha256 text) returns void
language sql security invoker set search_path='' as $$select clinic_private.attest_medical_document_upload(p_upload_id,p_author_id,p_object_id,p_object_version,p_sha256)$$;

revoke all on function clinic_private.document_upload_allowed(text,text),clinic_private.begin_medical_document_upload(uuid,uuid,uuid,text,text,text,bigint),clinic_private.complete_medical_document_upload(uuid),clinic_private.abandon_medical_document_upload(uuid),clinic_private.attest_medical_document_upload(uuid,uuid,uuid,text,text),public.begin_medical_document_upload(uuid,uuid,uuid,text,text,text,bigint),public.complete_medical_document_upload(uuid),public.abandon_medical_document_upload(uuid),public.attest_medical_document_upload(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function clinic_private.document_upload_allowed(text,text),clinic_private.begin_medical_document_upload(uuid,uuid,uuid,text,text,text,bigint),clinic_private.complete_medical_document_upload(uuid),clinic_private.abandon_medical_document_upload(uuid),public.begin_medical_document_upload(uuid,uuid,uuid,text,text,text,bigint),public.complete_medical_document_upload(uuid),public.abandon_medical_document_upload(uuid) to authenticated;
grant usage on schema clinic_private to service_role;
grant execute on function clinic_private.attest_medical_document_upload(uuid,uuid,uuid,text,text),public.attest_medical_document_upload(uuid,uuid,uuid,text,text) to service_role;

-- Storage operations use user JWTs. No UPDATE permission exists for this bucket.
create policy clinic_document_insert on storage.objects for insert to authenticated with check(bucket_id='clinic-medical-documents' and owner_id=(select auth.uid())::text and clinic_private.document_upload_allowed(name,'insert'));
create policy clinic_document_insert_guard on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'clinic-medical-documents' or (owner_id=(select auth.uid())::text and clinic_private.document_upload_allowed(name,'insert')));
create policy clinic_document_read on storage.objects for select to authenticated using(bucket_id='clinic-medical-documents' and (exists(select 1 from public.medical_documents d where d.storage_object_key=storage.objects.name) or clinic_private.document_upload_allowed(name,'read')));
create policy clinic_document_read_guard on storage.objects as restrictive for select to authenticated using(bucket_id<>'clinic-medical-documents' or exists(select 1 from public.medical_documents d where d.storage_object_key=storage.objects.name) or clinic_private.document_upload_allowed(name,'read'));
create policy clinic_document_cleanup on storage.objects for delete to authenticated using(bucket_id='clinic-medical-documents' and owner_id=(select auth.uid())::text and clinic_private.document_upload_allowed(name,'delete'));
create policy clinic_document_cleanup_guard on storage.objects as restrictive for delete to authenticated using(bucket_id<>'clinic-medical-documents' or (owner_id=(select auth.uid())::text and clinic_private.document_upload_allowed(name,'delete')));
create policy clinic_document_no_replace on storage.objects as restrictive for update to authenticated using(bucket_id<>'clinic-medical-documents') with check(bucket_id<>'clinic-medical-documents');
create policy clinic_document_anonymous_deny on storage.objects as restrictive for all to anon using(bucket_id<>'clinic-medical-documents') with check(bucket_id<>'clinic-medical-documents');
commit;
