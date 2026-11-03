-- LOCAL TEST FIXTURE ONLY. Never include in a remote/production apply.
-- auth.users rows have UUIDs only in the test shim: no login/password/onboarding implementation.
insert into auth.users(id) select ('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,13) i;
insert into public.organizations(id,name) values
 ('10000000-0000-4000-8000-000000000001','SRO Fictional Organization'),
 ('10000000-0000-4000-8000-000000000002','Unrelated Fictional Organization');
insert into public.profiles(id,name,email)
 select id,'Fictional Persona '||row_number() over(order by id),'persona'||row_number() over(order by id)||'@example.test' from auth.users;
insert into public.organization_memberships(organization_id,user_id)
 select '10000000-0000-4000-8000-000000000001',id from auth.users
 where id not in ('30000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000010','30000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000013');
insert into public.organization_memberships(organization_id,user_id)
 select '10000000-0000-4000-8000-000000000002',id from auth.users
 where id in ('30000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000013');
insert into public.role_assignments
 select organization_id,user_id,(case right(user_id::text,2)
  when '01' then 'admin' when '02' then 'admin' when '03' then 'doctor' when '04' then 'doctor'
  when '05' then 'clinical_staff' when '09' then 'admin' when '11' then 'doctor' when '12' then 'doctor'
  else 'patient' end)::public.clinic_role from public.organization_memberships;
insert into public.branches(id,organization_id,name,address) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','SRO Main Fictional Clinic','Fictional address A'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','SRO Second Fictional Clinic','Fictional address B'),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','Unrelated Fictional Clinic','Fictional address C');
insert into public.branch_memberships(organization_id,branch_id,user_id)
 select m.organization_id,b.id,m.user_id from public.organization_memberships m join public.branches b using(organization_id)
 where (b.id='20000000-0000-4000-8000-000000000001' and right(m.user_id::text,2) in ('01','02','03','04','05','06','07'))
 or (b.id='20000000-0000-4000-8000-000000000002' and right(m.user_id::text,2) in ('02','03','08','11'))
 or b.id='20000000-0000-4000-8000-000000000003';
insert into public.specializations(id,organization_id,name) values
 ('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','General Medicine'),
 ('70000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','General Medicine');
insert into public.symptom_categories(id,organization_id,name) values
 ('70000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','General check-up');
insert into public.specialization_symptoms values
 ('10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000003');
insert into public.doctors(id,organization_id,user_id,specialization_id,name,active) values
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000001','Dr. Fictional Assigned',true),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000001','Dr. Fictional Other',true),
 ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000011','70000000-0000-4000-8000-000000000001','Dr. Fictional Branch B',true),
 ('40000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000012','70000000-0000-4000-8000-000000000002','Dr. Unrelated',true);
insert into public.doctor_branch_assignments(organization_id,doctor_id,branch_id,fee_paisa) values
 ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',150000),
 ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',0),
 ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',100000),
 ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002',0),
 ('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000003',0);
insert into public.patients(id,organization_id,user_id,home_branch_id,name,date_of_birth,gender) values
 ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000001','Fictional Patient A','1992-01-01','Not recorded'),
 ('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000001','Fictional Patient B','1990-01-01','Not recorded'),
 ('50000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000002','Fictional Patient C','1995-01-01','Not recorded'),
 ('50000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000013','20000000-0000-4000-8000-000000000003','Unrelated Fictional Patient','1980-01-01','Not recorded');
insert into public.patient_branches select organization_id,id,home_branch_id from public.patients;
insert into public.patient_medical_history(organization_id,patient_id,allergies,review_state)
 select organization_id,id,array['Fictional reported allergy'],'reviewed' from public.patients;
insert into public.doctor_schedules(organization_id,doctor_id,branch_id,weekday,starts_at,ends_at,valid_from)
 select organization_id,doctor_id,branch_id,day,'09:00','17:00','2099-01-01' from public.doctor_branch_assignments cross join generate_series(0,6) day;
insert into public.schedule_breaks(organization_id,schedule_id,starts_at,ends_at)
 select organization_id,id,'12:00','13:00' from public.doctor_schedules;
insert into public.appointment_slots(id,organization_id,doctor_id,branch_id,starts_at,ends_at)
 select ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  start_time,start_time+interval '30 minutes'
 from (values (1,'2100-01-04T04:00Z'::timestamptz),(2,'2100-01-04T04:30Z'::timestamptz),
  (3,'2100-01-04T05:00Z'::timestamptz),(4,'2100-01-04T05:30Z'::timestamptz),
  (5,'2100-01-04T07:00Z'::timestamptz),(11,'2000-01-04T04:00Z'::timestamptz),
  (12,'2100-01-04T04:15Z'::timestamptz),(13,'2100-01-04T14:00Z'::timestamptz)) t(n,start_time);
insert into public.appointment_slots(id,organization_id,doctor_id,branch_id,starts_at,ends_at) values
 ('60000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','2100-01-04T04:00Z','2100-01-04T04:30Z'),
 ('60000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','2100-01-04T06:00Z','2100-01-04T06:30Z'),
 ('60000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','2100-01-04T04:00Z','2100-01-04T04:30Z'),
 ('60000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','2100-01-04T04:00Z','2100-01-04T04:30Z'),
 ('60000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000003','2100-01-04T04:00Z','2100-01-04T04:30Z');
insert into public.medical_documents(organization_id,patient_id,branch_id,author_id,kind,name,mime_type,size_bytes)
 select organization_id,id,home_branch_id,case when organization_id='10000000-0000-4000-8000-000000000001' then '30000000-0000-4000-8000-000000000002'::uuid else '30000000-0000-4000-8000-000000000009'::uuid end,
  'report','Fictional metadata only.pdf','application/pdf',1024 from public.patients;
insert into public.doctor_invitations(id,organization_id,branch_id,specialization_id,name,email,invited_by,expires_at) values
 ('80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001','Dr. Fictional Invite','invited@example.test','30000000-0000-4000-8000-000000000001','2100-01-01');
insert into clinic_private.invitation_secrets(invitation_id,token_hash) values
 ('80000000-0000-4000-8000-000000000001',decode(repeat('ab',32),'hex'));
