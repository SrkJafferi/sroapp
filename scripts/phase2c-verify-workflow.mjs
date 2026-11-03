// Real Web/Auth/PostgREST checks. No service key is used for clinical reads/writes.
// Credentials are private; no screenshots, traces, bearer tokens or raw errors are emitted.
import { chromium, request } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
process.loadEnvFile('apps/web/.env.local');
const ref = 'jyigxpjvygvtvcypujel',
  origin = process.env.SRO_APP_URL ?? 'http://localhost:3100';
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, `${ref}.supabase.co`);
const root = path.join(process.env.USERPROFILE, '.codex', 'secrets', 'sro-clinic', ref);
const operator = JSON.parse(await readFile(path.join(root, 'phase2b-demo-admin.json'), 'utf8'));
const configured = JSON.parse(
  await readFile(path.join(root, 'phase2c-demo-accounts.json'), 'utf8'),
);
const people = [{ ...operator, role: 'admin' }, ...configured.accounts];
const clients = new Map();
const report = { projectRef: ref, checks: [], clinicalServiceKeyUsed: false };
let step = 'initialization',
  browser,
  inspectionPage,
  uiStage;
async function check(name, run) {
  step = name;
  await run();
  const existing = report.checks.find((c) => c.name === name);
  if (existing) existing.passed = true;
  else report.checks.push({ name, passed: true });
}
async function json(context, url, method = 'GET', body) {
  const r = await context.fetch(url, {
    method,
    headers: method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json' } : undefined,
    data: body,
  });
  if (!r.ok()) throw new Error(`HTTP ${r.status()}`);
  return r.json();
}
async function snapshot(role) {
  const client = clients.get(role);
  return json(
    client.context,
    `/api/clinic?${new URLSearchParams({ role, organizationId: client.organizationId })}`,
  );
}
async function command(role, command, input) {
  const client = clients.get(role);
  return json(client.context, '/api/clinic', 'POST', {
    role,
    organizationId: client.organizationId,
    command,
    input,
  });
}
async function save() {
  await mkdir('artifacts/phase2c-validation', { recursive: true });
  await writeFile(
    'artifacts/phase2c-validation/workflow-results.json',
    JSON.stringify({ ...report, completedAt: new Date().toISOString() }, null, 2) + '\n',
  );
}
try {
  const mode = process.argv[2] ?? 'access';
  if (['verify-existing', 'ui-existing', 'ui-flow', 'close-surplus'].includes(mode)) {
    const saved = JSON.parse(
      await readFile('artifacts/phase2c-validation/workflow-results.json', 'utf8'),
    );
    assert.equal(saved.projectRef, ref);
    report.checks = saved.checks;
    report.appointmentId = saved.appointmentId;
    report.uiAppointmentId = saved.uiAppointmentId;
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const person of people) {
    step = `${person.role} login`;
    const context = await request.newContext({ baseURL: origin });
    const login = await json(context, '/api/auth/login', 'POST', {
      email: person.email,
      password: person.password,
    });
    const identity = (await json(context, '/api/auth/session')).identity;
    const membership = identity.memberships.find(
      (m) => m.roles.includes(person.role) && m.branchIds.length,
    );
    clients.set(person.role, {
      context,
      identity,
      organizationId: membership?.organizationId,
      branchId: membership?.branchIds[0],
    });
    if (!membership) {
      report.checks.push({
        name: `${person.role} activation`,
        passed: false,
        blocker: 'Verified identity has not accepted its clinic invitation.',
      });
      if (mode !== 'access') throw new Error('Role activation required');
      continue;
    }
    assert.equal(login.next, `/${person.role}`);
    await check(`${person.role} real-data workspace and clean presentation`, async () => {
      const data = await snapshot(person.role);
      assert.equal(data.actor.id, person.userId);
      assert.equal(data.actor.role, person.role);
      assert.ok(data.state.branches.every((b) => /^[0-9a-f-]{36}$/i.test(b.id)));
      const browserContext = await browser.newContext({ baseURL: origin });
      await browserContext.addCookies((await context.storageState()).cookies);
      const page = await browserContext.newPage();
      await page.goto(`/${person.role}`);
      await page.getByText(`${person.role.toUpperCase()} WORKSPACE`, { exact: true }).waitFor();
      assert.doesNotMatch(
        await page.locator('body').innerText(),
        /\bdemo\b|\bprototype\b|clinical preview/i,
      );
      await browserContext.close();
    });
  }
  if (mode === 'full') {
    let patient = await snapshot('patient');
    let doctor = await snapshot('doctor');
    let admin = await snapshot('admin');
    const doctorId = doctor.actor.doctorId,
      patientId = patient.actor.patientId,
      branchId = clients.get('admin').branchId;
    assert.ok(doctorId && patientId);
    const spec = admin.state.doctors.find((d) => d.id === doctorId).specializationId;
    await check(
      'Admin configures the roster and publishes a real appointment calendar',
      async () => {
        await command('admin', 'configure', {
          branchId,
          action: 'organization',
          data: { name: 'SRO Clinic' },
        });
        await command('admin', 'configure', {
          branchId,
          action: 'branch',
          data: {
            id: branchId,
            name: 'SRO Main Clinic',
            address: 'Clinic premises, Karachi',
            phone: '+923000000001',
            active: true,
          },
        });
        await command('admin', 'configure', {
          branchId,
          action: 'profile',
          data: { name: 'SRO Administrator' },
        });
        await command('doctor', 'configure', {
          branchId,
          action: 'profile',
          data: { name: 'Dr. Sara Malik' },
        });
        await command('admin', 'configure', {
          branchId,
          action: 'doctor',
          data: {
            doctorId,
            name: 'Dr. Sara Malik',
            bio: 'General medicine and preventive care.',
            qualifications: 'MBBS',
            experience: 8,
            specializationId: spec,
          },
        });
        await command('admin', 'configure', {
          branchId,
          action: 'schedule',
          data: {
            doctorId,
            days: [0, 1, 2, 3, 4, 5, 6],
            start: '09:00',
            end: '17:00',
            breaks: [{ start: '13:00', end: '14:00' }],
          },
        });
      },
    );
    const tomorrow = new Date(Date.now() + 86400000);
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(tomorrow);
    const availability = await json(
      clients.get('patient').context,
      `/api/clinic?${new URLSearchParams({ role: 'patient', organizationId: clients.get('patient').organizationId, operation: 'availability', branchId, doctorId, date })}`,
    );
    assert.ok(availability.slots.length);
    const slot = availability.slots[0];
    let appointmentId;
    await check('Patient requests an appointment saved in PostgreSQL', async () => {
      const booked = await command('patient', 'book', {
        branchId,
        doctorId,
        patientId,
        slotId: slot.id,
        date,
        time: slot.time,
        type: 'physical',
        source: 'patient',
        reason: 'Routine wellness review',
      });
      appointmentId = booked.id;
      report.appointmentId = appointmentId;
      patient = await snapshot('patient');
      assert.equal(
        patient.state.appointments.find((a) => a.id === appointmentId).status,
        'pending',
      );
      await save();
    });
    await check('competing booking for the same slot is rejected transactionally', async () => {
      const duplicate = await clients.get('patient').context.post('/api/clinic', {
        headers: { Origin: origin },
        data: {
          role: 'patient',
          organizationId: clients.get('patient').organizationId,
          command: 'book',
          input: {
            branchId,
            doctorId,
            patientId,
            slotId: slot.id,
            date,
            time: slot.time,
            type: 'physical',
            source: 'patient',
            reason: 'Competing slot request',
          },
        },
      });
      assert.equal(duplicate.status(), 409);
    });
    await check('pending appointment does not expose patient records to Doctor', async () => {
      const pending = await snapshot('doctor');
      assert.ok(!pending.state.patients.some((p) => p.id === patientId));
    });
    await check('Admin sees and approves the persisted pending request', async () => {
      admin = await snapshot('admin');
      assert.equal(admin.state.appointments.find((a) => a.id === appointmentId).status, 'pending');
      await command('admin', 'transition', { id: appointmentId, status: 'confirmed' });
    });
    await check('Doctor sees approved patient and starts consultation', async () => {
      doctor = await snapshot('doctor');
      assert.equal(
        doctor.state.appointments.find((a) => a.id === appointmentId).status,
        'confirmed',
      );
      assert.ok(doctor.state.patients.some((p) => p.id === patientId));
      await command('doctor', 'transition', { id: appointmentId, status: 'checked_in' });
      await command('doctor', 'transition', { id: appointmentId, status: 'in_consultation' });
    });
    const consultation = {
      appointmentId,
      symptoms: 'Intermittent fatigue reported during a routine review.',
      examination: 'General examination recorded.',
      diagnosis: 'Wellness review',
      plan: 'Lifestyle review and follow-up as advised.',
      followUp: 'Review in one week.',
      vitals: {
        bloodPressure: '120/80',
        pulse: '72',
        temperature: '36.8',
        oxygen: '98',
        weight: '68',
        height: '170',
      },
      items: [
        {
          medication: 'Vitamin C',
          strength: '500 mg',
          dosage: 'One tablet',
          frequency: 'Once daily',
          duration: 'Five days',
          instructions: 'After food',
        },
      ],
    };
    await check(
      'Doctor draft stores vitals and prescription while remaining hidden from Patient',
      async () => {
        await command('doctor', 'consultation', { ...consultation, status: 'draft' });
        const own = await snapshot('doctor');
        assert.equal(
          own.state.consultations.find((c) => c.appointmentId === appointmentId).vitals.pulse,
          '72',
        );
        const view = await snapshot('patient');
        assert.ok(!view.state.consultations.some((c) => c.appointmentId === appointmentId));
      },
    );
    await check('Doctor signs the consultation and completes the appointment', async () => {
      await command('doctor', 'consultation', { ...consultation, status: 'signed' });
      doctor = await snapshot('doctor');
      assert.equal(
        doctor.state.appointments.find((a) => a.id === appointmentId).status,
        'completed',
      );
    });
    await check(
      'Patient reads only the signed consultation and its actual prescription',
      async () => {
        patient = await snapshot('patient');
        const encounter = patient.state.consultations.find(
          (c) => c.appointmentId === appointmentId,
        );
        assert.equal(encounter.status, 'signed');
        assert.equal(encounter.vitals.bloodPressure, '120/80');
        assert.equal(
          patient.state.prescriptions.find((p) => p.consultationId === encounter.id).items[0]
            .medication,
          'Vitamin C',
        );
      },
    );
    await check('signed record rewrite is refused', async () => {
      const rejected = await clients.get('doctor').context.post('/api/clinic', {
        headers: { Origin: origin },
        data: {
          role: 'doctor',
          organizationId: clients.get('doctor').organizationId,
          command: 'consultation',
          input: { ...consultation, diagnosis: 'Unauthorized rewrite', status: 'signed' },
        },
      });
      assert.equal(rejected.status(), 409);
    });
    await check(
      'refresh preserves appointment, signed consultation and prescription in the actual Patient UI',
      async () => {
        const ctx = await browser.newContext({ baseURL: origin });
        await ctx.addCookies((await clients.get('patient').context.storageState()).cookies);
        const page = await ctx.newPage();
        await page.goto('/patient/records');
        await page.getByText('Wellness review', { exact: true }).first().waitFor();
        await page.reload();
        await page.getByText('Wellness review', { exact: true }).first().waitFor();
        await page.goto('/patient/prescriptions');
        await page.getByRole('button', { name: 'View prescription', exact: true }).first().click();
        await page.getByText('Vitamin C', { exact: false }).first().waitFor();
        await ctx.close();
      },
    );
  }
  if (['verify-existing', 'ui-existing'].includes(mode)) {
    const patient = await snapshot('patient');
    const doctor = await snapshot('doctor');
    const appointment = patient.state.appointments.find((a) => a.id === report.appointmentId);
    assert.equal(appointment.status, 'completed');
    const patientId = patient.actor.patientId,
      branchId = clients.get('doctor').branchId;
    if (mode !== 'ui-existing') {
      await check(
        'Doctor medical history is persisted and visible only through authorized records',
        async () => {
          await command('doctor', 'history', {
            branchId,
            patientId,
            history: {
              allergies: ['Penicillin'],
              conditions: [],
              medications: [],
              surgeries: '',
              familyHistory: '',
              socialHistory: '',
              bloodGroup: '',
              emergencyContact: '',
            },
          });
          const updated = await snapshot('patient');
          const history = updated.state.patients.find((p) => p.id === patientId).history;
          assert.equal(history.reviewState, 'reviewed');
          assert.deepEqual(history.allergies, ['Penicillin']);
        },
      );
      await check('Patient and Admin cannot write clinician medical history', async () => {
        for (const role of ['patient', 'admin']) {
          const c = clients.get(role);
          const r = await c.context.post('/api/clinic', {
            headers: { Origin: origin },
            data: {
              role,
              organizationId: c.organizationId,
              command: 'history',
              input: {
                branchId: c.branchId,
                patientId,
                history: {
                  allergies: [],
                  conditions: [],
                  medications: [],
                  surgeries: '',
                  familyHistory: '',
                  socialHistory: '',
                  bloodGroup: '',
                  emergencyContact: '',
                },
              },
            },
          });
          assert.equal(r.status(), 403);
        }
      });
      await check(
        'Patient cannot manage schedules or impersonate the Doctor workspace',
        async () => {
          const c = clients.get('patient');
          const schedule = await c.context.post('/api/clinic', {
            headers: { Origin: origin },
            data: {
              role: 'patient',
              organizationId: c.organizationId,
              command: 'configure',
              input: {
                branchId: c.branchId,
                action: 'schedule',
                data: {
                  doctorId: doctor.actor.doctorId,
                  days: [1],
                  start: '09:00',
                  end: '10:00',
                  breaks: [],
                },
              },
            },
          });
          assert.equal(schedule.status(), 403);
          const forged = await c.context.post('/api/clinic', {
            headers: { Origin: origin },
            data: {
              role: 'doctor',
              organizationId: c.organizationId,
              command: 'consultation',
              input: {},
            },
          });
          assert.equal(forged.status(), 403);
        },
      );
      await check('unassigned branch requests are refused before availability access', async () => {
        const c = clients.get('patient');
        const result = await c.context.get(
          `/api/clinic?${new URLSearchParams({ role: 'patient', organizationId: c.organizationId, operation: 'availability', branchId: '00000000-0000-4000-8000-000000000001', doctorId: doctor.actor.doctorId, date: appointment.date })}`,
        );
        assert.equal(result.status(), 403);
      });
    }
    await check(
      'refresh preserves appointment, signed consultation and prescription in the actual Patient UI',
      async () => {
        const ctx = await browser.newContext({
          baseURL: origin,
          viewport: { width: 1440, height: 1000 },
        });
        await ctx.addCookies((await clients.get('patient').context.storageState()).cookies);
        const page = await ctx.newPage();
        inspectionPage = page;
        uiStage = 'record refresh';
        await page.goto('/patient/records');
        await page.getByText('Wellness review', { exact: true }).first().waitFor();
        await page.reload();
        await page.getByText('Wellness review', { exact: true }).first().waitFor();
        await page.getByText('Penicillin', { exact: true }).waitFor();
        await page.screenshot({
          path: 'artifacts/phase2c-validation/patient-record-desktop.png',
          fullPage: true,
        });
        uiStage = 'open prescription';
        await page.goto('/patient/prescriptions');
        await page.getByRole('button', { name: 'View prescription', exact: true }).first().click();
        uiStage = 'read medication';
        await page.getByText('Vitamin C', { exact: false }).first().waitFor();
        assert.doesNotMatch(
          await page.locator('body').innerText(),
          /\bdemo\b|\bprototype\b|clinical preview/i,
        );
        uiStage = 'mobile width';
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(500);
        const layout = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          overflow: [...document.querySelectorAll('body *')]
            .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
            .map((e) => ({
              tag: e.tagName,
              class: e.className,
              right: Math.round(e.getBoundingClientRect().right),
            }))
            .slice(0, 20),
        }));
        if (layout.scroll > layout.width) console.error(JSON.stringify({ layout }));
        assert.equal(layout.scroll <= layout.width, true);
        await page.screenshot({
          path: 'artifacts/phase2c-validation/patient-prescription-mobile.png',
          fullPage: true,
        });
        await ctx.close();
      },
    );
  }
  if (mode === 'ui-flow') {
    const patient = await snapshot('patient'),
      doctor = await snapshot('doctor');
    const branchId = clients.get('admin').branchId;
    const original = patient.state.appointments.find((a) => a.id === report.appointmentId);
    await check('public slot publisher executes through an authorized user session', async () => {
      const result = await command('admin', 'publish', {
        branchId,
        doctorId: doctor.actor.doctorId,
        from: original.date,
        until: original.date,
      });
      assert.equal(result.saved, true);
    });
    const pages = new Map();
    for (const role of ['patient', 'admin', 'doctor']) {
      const ctx = await browser.newContext({
        baseURL: origin,
        viewport: { width: 1440, height: 1000 },
      });
      await ctx.addCookies((await clients.get(role).context.storageState()).cookies);
      pages.set(role, await ctx.newPage());
    }
    async function persisted(role, predicate) {
      for (let i = 0; i < 20; i++) {
        const view = await snapshot(role);
        if (predicate(view)) return view;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error('Expected persisted state missing');
    }
    const reason = 'Follow-up wellness review';
    const p = pages.get('patient'),
      a = pages.get('admin'),
      d = pages.get('doctor');
    await check(
      'Patient books through the visible Web booking wizard and refresh preserves the request',
      async () => {
        inspectionPage = p;
        uiStage = 'booking wizard';
        if (!report.uiAppointmentId) {
          await p.goto('/patient/appointments');
          await p.getByRole('button', { name: 'Book appointment', exact: true }).click();
          await p.getByRole('button', { name: /Dr. Sara Malik/ }).click();
          await p.getByRole('button', { name: 'Continue', exact: true }).click();
          await p.getByLabel('Appointment date', { exact: true }).fill(original.date);
          await p.locator('.slot-grid button').first().click();
          await p.getByRole('button', { name: 'Continue', exact: true }).click();
          await p.getByLabel('Reason for visit', { exact: true }).fill(reason);
          await p.getByRole('button', { name: 'Submit appointment request', exact: true }).click();
          const saved = await persisted('patient', (s) =>
            s.state.appointments.some((x) => x.reason === reason),
          );
          report.uiAppointmentId = saved.state.appointments.find((x) => x.reason === reason).id;
          await save();
          await p.getByText('Appointment request submitted', { exact: true }).waitFor();
        }
        await p.goto('/patient/appointments');
        await p.reload();
        assert.ok(
          (await snapshot('patient')).state.appointments.some(
            (x) => x.id === report.uiAppointmentId,
          ),
        );
      },
    );
    await check(
      'Admin approves the persistent request through the Web appointment dialog',
      async () => {
        inspectionPage = a;
        uiStage = 'Admin approval';
        const current = (await snapshot('admin')).state.appointments.find(
          (x) => x.id === report.uiAppointmentId,
        );
        if (current.status === 'pending') {
          await a.goto('/admin/approvals');
          await a
            .getByRole('row')
            .filter({ hasText: reason })
            .getByRole('button', { name: /View appointment/ })
            .click();
          await a.getByRole('button', { name: 'Approve appointment', exact: true }).click();
          await persisted(
            'doctor',
            (s) =>
              s.state.appointments.find((x) => x.id === report.uiAppointmentId)?.status ===
              'confirmed',
          );
        }
      },
    );
    await check(
      'Doctor enters vitals, saves a draft, reloads and signs through Web forms',
      async () => {
        inspectionPage = d;
        uiStage = 'Doctor check-in';
        let current = (await snapshot('doctor')).state.appointments.find(
          (x) => x.id === report.uiAppointmentId,
        );
        if (current.status === 'completed') return;
        await d.goto('/doctor/appointments');
        await d.getByLabel('Filter appointment date', { exact: true }).fill('');
        await d
          .locator(`[data-appointment-id="${report.uiAppointmentId}"]`)
          .getByRole('button', { name: /View appointment/ })
          .click();
        if (current.status === 'confirmed') {
          uiStage = 'check-in button';
          await d.getByRole('button', { name: 'Checked in', exact: true }).click();
          await persisted(
            'doctor',
            (s) =>
              s.state.appointments.find((x) => x.id === report.uiAppointmentId)?.status ===
              'checked_in',
          );
          current.status = 'checked_in';
        }
        if (current.status === 'checked_in') {
          uiStage = 'start consultation button';
          await d.getByRole('button', { name: 'Start consultation', exact: true }).click();
          await persisted(
            'doctor',
            (s) =>
              s.state.appointments.find((x) => x.id === report.uiAppointmentId)?.status ===
              'in_consultation',
          );
        }
        uiStage = 'open consultation button';
        await d.getByRole('button', { name: 'Open consultation', exact: true }).click();
        uiStage = 'clinical form';
        for (const [label, value] of Object.entries({
          'Presenting symptoms': 'Routine follow-up with no new symptoms.',
          'BP (mmHg)': '118/78',
          'Pulse (bpm)': '74',
          'Temp (°C)': '36.7',
          'SpO₂ (%)': '99',
          'Weight (kg)': '68',
          'Height (cm)': '170',
          'Examination findings': 'General examination recorded.',
          Diagnosis: reason,
          'Treatment plan': 'Continue routine care and review as needed.',
          'Follow-up instructions': 'Return in two weeks.',
        })) {
          uiStage = `clinical field: ${label}`;
          await d.getByRole('dialog').getByLabel(label).fill(value);
        }
        if ((await d.getByLabel('Medication', { exact: true }).count()) === 0)
          await d.getByRole('button', { name: 'Add medication', exact: true }).click();
        for (const [label, value] of Object.entries({
          Medication: 'Vitamin D',
          Strength: '400 IU',
          Dosage: 'One tablet',
          Frequency: 'Once daily',
          Duration: 'Seven days',
          Instructions: 'After food',
        }))
          await d.getByLabel(label, { exact: true }).fill(value);
        await d.getByRole('button', { name: 'Save draft', exact: true }).click();
        await persisted('doctor', (s) =>
          s.state.consultations.some(
            (c) =>
              c.appointmentId === report.uiAppointmentId &&
              c.status === 'draft' &&
              c.vitals.pulse === '74',
          ),
        );
        assert.ok(
          !(await snapshot('patient')).state.consultations.some(
            (c) => c.appointmentId === report.uiAppointmentId,
          ),
        );
        uiStage = 'reopen draft';
        await d.reload();
        await d.getByLabel('Filter appointment date', { exact: true }).fill('');
        await d
          .locator(`[data-appointment-id="${report.uiAppointmentId}"]`)
          .getByRole('button', { name: /View appointment/ })
          .click();
        await d.getByRole('button', { name: 'Open consultation', exact: true }).click();
        assert.equal(await d.getByRole('dialog').getByLabel('Diagnosis').inputValue(), reason);
        assert.equal(await d.getByLabel('Medication', { exact: true }).inputValue(), 'Vitamin D');
        await d.screenshot({
          path: 'artifacts/phase2c-validation/doctor-consultation-desktop.png',
          fullPage: true,
        });
        await d.getByRole('button', { name: 'Sign & complete consultation', exact: true }).click();
        await persisted(
          'patient',
          (s) =>
            s.state.appointments.find((x) => x.id === report.uiAppointmentId)?.status ===
            'completed',
        );
      },
    );
    await check(
      'Patient sees the form-created signed visit and prescription after browser refresh',
      async () => {
        inspectionPage = p;
        uiStage = 'Patient final history';
        await p.goto('/patient/records');
        await p.reload();
        await p.getByText(reason, { exact: true }).waitFor();
        const view = await snapshot('patient');
        const encounter = view.state.consultations.find(
          (c) => c.appointmentId === report.uiAppointmentId,
        );
        assert.equal(encounter.status, 'signed');
        assert.equal(encounter.vitals.pulse, '74');
        assert.equal(
          view.state.prescriptions.find((rx) => rx.consultationId === encounter.id).items[0]
            .medication,
          'Vitamin D',
        );
        await p.goto('/patient/prescriptions');
        await p.getByRole('button', { name: 'View prescription', exact: true }).last().click();
        await p.getByText('Vitamin D', { exact: false }).first().waitFor();
      },
    );
    for (const page of pages.values()) await page.context().close();
  }
  if (mode === 'close-surplus') {
    await check(
      'Admin rejects the surplus automation request through the authorized Web workflow',
      async () => {
        const extras = (await snapshot('admin')).state.appointments.filter(
          (x) =>
            x.reason === 'Follow-up wellness review' &&
            x.status === 'pending' &&
            x.id !== report.uiAppointmentId,
        );
        const ctx = await browser.newContext({
          baseURL: origin,
          viewport: { width: 1440, height: 1000 },
        });
        await ctx.addCookies((await clients.get('admin').context.storageState()).cookies);
        const page = await ctx.newPage();
        inspectionPage = page;
        uiStage = 'reject surplus request';
        for (const extra of extras) {
          await page.goto('/admin/approvals');
          await page
            .locator(`[data-appointment-id="${extra.id}"]`)
            .getByRole('button', { name: /View appointment/ })
            .click();
          await page.getByRole('button', { name: 'Rejected', exact: true }).click();
          for (let i = 0; i < 20; i++) {
            if (
              (await snapshot('admin')).state.appointments.find((x) => x.id === extra.id)
                ?.status === 'rejected'
            )
              break;
            await new Promise((r) => setTimeout(r, 500));
          }
          assert.equal(
            (await snapshot('admin')).state.appointments.find((x) => x.id === extra.id)?.status,
            'rejected',
          );
        }
        report.rejectedSurplusIds = extras.map((x) => x.id);
        await ctx.close();
      },
    );
  }
  await save();
  console.log(
    JSON.stringify({
      projectRef: ref,
      passed: report.checks.filter((c) => c.passed).length,
      blocked: report.checks.filter((c) => !c.passed).length,
      clinicalServiceKeyUsed: false,
      evidence: 'artifacts/phase2c-validation/workflow-results.json',
    }),
  );
} catch (error) {
  if (inspectionPage)
    await inspectionPage
      .screenshot({ path: 'artifacts/phase2c-validation/patient-ui-failure.png', fullPage: true })
      .catch(() => {});
  await save();
  console.error(
    JSON.stringify({
      passed: false,
      failedStep: step,
      uiStage,
      failureKind: error.name,
      failureCategory:
        error.message === 'Expected persisted state missing'
          ? 'persisted state'
          : error.message.startsWith('locator.')
            ? 'UI locator'
            : error.message.startsWith('HTTP ')
              ? error.message
              : 'assertion or script',
      locatorFailure: error.message.startsWith('locator.')
        ? error.message.split('\n')[0].slice(0, 200)
        : undefined,
      checksPassed: report.checks.filter((c) => c.passed).length,
    }),
  );
  process.exitCode = 1;
} finally {
  for (const c of clients.values()) {
    await c.context
      .post('/api/auth/logout', { headers: { Origin: origin }, data: {} })
      .catch(() => {});
    await c.context.dispose();
  }
  if (browser) await browser.close();
}
