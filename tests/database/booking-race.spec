# Optional PostgreSQL isolationtester specification. NOT executed by check:db.
# Requires a NEW disposable PostgreSQL 17 DB with auth shim, migrations and fictional fixture.
# Never run against a remote project or a database containing real records.
# Native PostgreSQL's isolationtester must schedule the blocked step, then commit s1.
setup { SELECT 1; }
teardown { SELECT 1; }

session "s1"
step "s1_begin" {
  BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claim.sub = '30000000-0000-4000-8000-000000000006';
}
step "s1_book" {
  SELECT public.book_appointment('60000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001','Fictional concurrency A');
}
step "s1_commit" { COMMIT; }

session "s2"
step "s2_begin" {
  BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claim.sub = '30000000-0000-4000-8000-000000000007';
}
step "s2_book" {
  SELECT public.book_appointment('60000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002','Fictional concurrency B');
}
step "s2_finish" { ROLLBACK; }

# Expected: s2_book blocks on the doctor lock, then fails 23P01 after s1 commits.
permutation "s1_begin" "s2_begin" "s1_book" "s2_book" "s1_commit" "s2_finish"
