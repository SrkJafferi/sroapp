import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

test('all role pages render and navigation stays within the workspace', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const pages: Record<string, string[]> = {
    admin: [
      '',
      'appointments',
      'approvals',
      'doctors',
      'doctors/d1',
      'patients',
      'branches',
      'specializations',
      'schedules',
      'records',
      'fees',
      'activity',
      'notifications',
      'settings',
    ],
    doctor: [
      '',
      'appointments',
      'approvals',
      'patients',
      'schedules',
      'records',
      'prescriptions',
      'reports',
      'notifications',
      'settings',
    ],
    patient: [
      '',
      'appointments',
      'doctors',
      'doctors/d1',
      'specializations',
      'records',
      'prescriptions',
      'reports',
      'notifications',
      'settings',
    ],
  };
  for (const [role, sections] of Object.entries(pages))
    for (const section of sections) {
      await page.goto(`/${role}/${section}`);
      await expect(page.locator('main h1')).toBeVisible();
      await expect(page.getByText('This page is unavailable', { exact: true })).toHaveCount(0);
      expect(
        await page
          .locator('img')
          .evaluateAll((images) =>
            images.every(
              (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      ).toBe(true);
    }
  expect(errors).toEqual([]);
});

test('patient request, admin approval and notification update without refresh', async ({
  page,
}) => {
  await page.goto('/patient');
  await page.getByRole('button', { name: 'Book appointment', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Dr. Sara Khan/ }).click();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: '9:30 AM', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByLabel('Reason for visit').fill('Fictional routine review');
  await dialog.getByRole('button', { name: 'Submit appointment request' }).click();
  await expect(dialog.getByText('Appointment request submitted', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to the clinic' }).click();
  await page.getByLabel('Demo role').selectOption('admin');
  await page.getByRole('link', { name: /Pending approvals/ }).click();
  const row = page.getByRole('row').filter({ hasText: 'Fictional routine review' });
  await row.getByRole('button', { name: /View appointment/ }).click();
  await dialog.getByRole('button', { name: 'Approve appointment' }).click();
  await expect(dialog.getByText('Confirmed', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Demo role').selectOption('patient');
  await page.getByRole('link', { name: /^Notifications,/ }).click();
  await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
});

test('assigned doctor signs a consultation and creates a prescription', async ({ page }) => {
  await page.goto('/doctor/appointments');
  const row = page.getByRole('row').filter({ hasText: 'Ali Raza' });
  await row.getByRole('button', { name: /View appointment/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Start consultation' }).click();
  await dialog.getByRole('button', { name: 'Open consultation' }).click();
  await dialog.getByLabel('Diagnosis', { exact: true }).fill('Fictional follow-up assessment');
  await dialog.getByLabel('Treatment plan', { exact: true }).fill('Fictional care plan for demo');
  await dialog.getByRole('button', { name: 'Add medication' }).click();
  for (const [label, value] of Object.entries({
    Medication: 'Demo medicine',
    Strength: 'Example strength',
    Dosage: 'Example dosage',
    Frequency: 'Example frequency',
    Duration: 'Example duration',
    Instructions: 'Not a real prescription',
  }))
    await dialog.getByLabel(label, { exact: true }).fill(value);
  await dialog.getByRole('button', { name: 'Sign & complete consultation' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('row').filter({ hasText: 'Ali Raza' }).getByText('Completed'),
  ).toBeVisible();
  await page.getByLabel('Demo role').selectOption('patient');
  await page.getByRole('link', { name: 'Prescriptions', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'View prescription' })).toHaveCount(2);
});

test('approved APT-101 completes with clinical notes and a patient-visible prescription', async ({
  page,
}) => {
  const errors: string[] = [];
  let externalRequests = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname === 'localhost') await route.continue();
    else {
      externalRequests += 1;
      await route.abort();
    }
  });
  await mkdir('artifacts/web-validation', { recursive: true });
  await page.goto('/patient');
  await page.getByRole('button', { name: 'Book appointment', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Dr. Sara Khan/ }).click();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.getByRole('button', { name: '9:30 AM', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  const reason = 'Fictional APT-101 workflow review';
  await dialog.getByLabel('Reason for visit').fill(reason);
  await dialog.getByRole('button', { name: 'Submit appointment request' }).click();
  await expect(dialog.getByText('Appointment request submitted', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to the clinic' }).click();
  await page.getByLabel('Demo role').selectOption('admin');
  await page.getByRole('link', { name: /Pending approvals/ }).click();
  await page
    .getByRole('row')
    .filter({ hasText: reason })
    .getByRole('button', { name: /View appointment/ })
    .click();
  await expect(dialog.getByText('APT-101 · Appointment request', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Approve appointment' }).click();
  await expect(dialog.getByText('Confirmed', { exact: true })).toBeVisible();
  await dialog.screenshot({ path: 'artifacts/web-validation/apt-101-admin-confirmed.png' });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByLabel('Demo role').selectOption('doctor');
  await page.getByRole('link', { name: 'Appointments', exact: true }).first().click();
  const appointment = page.getByRole('row').filter({ hasText: reason });
  await appointment.getByRole('button', { name: /View appointment/ }).click();
  await expect(dialog.getByText('APT-101 · Appointment request', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Confirmed', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Start consultation' }).click();
  await expect(dialog.getByText('In consultation', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Open consultation' }).click();
  const notes = {
    'Presenting symptoms': 'Fictional symptoms for workflow validation',
    'BP (mmHg)': '120/80',
    'Pulse (bpm)': '72',
    'Examination findings': 'Fictional examination for workflow validation',
    Diagnosis: 'Fictional APT-101 assessment',
    'Treatment plan': 'Fictional APT-101 care plan',
    'Follow-up instructions': 'Fictional follow-up only, no medical advice',
  };
  for (const [label, value] of Object.entries(notes))
    await dialog.getByRole('textbox', { name: label, exact: true }).fill(value);
  await dialog.getByRole('button', { name: 'Add medication' }).click();
  const medication = {
    Medication: 'APT-101 demo medicine',
    Strength: 'Example strength',
    Dosage: 'Example dosage',
    Frequency: 'Example frequency',
    Duration: 'Example duration',
    Instructions: 'Fictional entry, not for dispensing',
  };
  for (const [label, value] of Object.entries(medication))
    await dialog.getByLabel(label, { exact: true }).fill(value);
  await dialog.getByRole('button', { name: 'Sign & complete consultation' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(appointment.getByText('Completed', { exact: true })).toBeVisible();

  await page.getByLabel('Demo role').selectOption('patient');
  await page.getByRole('link', { name: 'Appointments', exact: true }).first().click();
  const patientAppointment = page.getByRole('row').filter({
    has: page.getByRole('button', {
      name: 'View appointment for Ali Raza at 9:30 AM',
      exact: true,
    }),
  });
  await expect(patientAppointment.getByText('Completed', { exact: true })).toBeVisible();
  await patientAppointment.getByRole('button', { name: /View appointment/ }).click();
  await expect(dialog.getByText('APT-101 · Appointment request', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Completed', { exact: true })).toBeVisible();
  await dialog.screenshot({ path: 'artifacts/web-validation/apt-101-patient-completed.png' });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('link', { name: 'Medical records', exact: true }).first().click();
  const signedRecord = page.locator('.consultation-record').filter({ hasText: notes.Diagnosis });
  await expect(signedRecord.getByText('Signed consultation', { exact: true })).toBeVisible();
  for (const value of Object.values(notes))
    await expect(signedRecord.getByText(value, { exact: true })).toBeVisible();
  await signedRecord.screenshot({ path: 'artifacts/web-validation/apt-101-patient-notes.png' });
  await page.getByRole('link', { name: 'Prescriptions', exact: true }).first().click();
  const prescriptions = page.getByRole('button', { name: 'View prescription' });
  await expect(prescriptions).toHaveCount(2);
  // Identify the new prescription by its medication, without relying on list ordering.
  let found = false;
  for (let index = 0; index < (await prescriptions.count()); index += 1) {
    await prescriptions.nth(index).click();
    if (await dialog.getByText(/APT-101 demo medicine/).count()) {
      found = true;
      for (const value of Object.values(medication))
        await expect(dialog.getByText(value, { exact: false })).toBeVisible();
      await expect(
        dialog.getByText(notes['Follow-up instructions'], { exact: true }),
      ).toBeVisible();
      await dialog.screenshot({
        path: 'artifacts/web-validation/apt-101-patient-prescription.png',
      });
      break;
    }
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
  }
  expect(found).toBe(true);
  expect(errors).toEqual([]);
  expect(externalRequests).toBe(0);
});

test('branch creation and doctor invitation remain local mock actions', async ({ page }) => {
  await page.goto('/admin/branches');
  await page.getByRole('button', { name: 'Add branch', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Branch name').fill('SRO Demo Outreach');
  await dialog.getByLabel('Branch address').fill('Fictional outreach location');
  await dialog.getByLabel('Phone number').fill('+92 300 000 1111');
  await dialog.getByRole('button', { name: 'Save demo changes' }).click();
  await expect(page.getByRole('heading', { name: 'SRO Demo Outreach' })).toBeVisible();
  await expect(page.getByLabel('Active clinic branch').locator('option')).toHaveCount(2);
  await page.getByRole('link', { name: 'Doctors', exact: true }).click();
  await page.getByRole('button', { name: 'Invite doctor' }).click();
  await dialog.getByLabel('Full name').fill('Dr. Demo Clinician');
  await dialog.getByLabel('Email address').fill('clinician@example.test');
  await dialog.getByRole('button', { name: 'Prepare demo invitation' }).click();
  await expect(dialog.getByText(/No email has been sent/)).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Preview doctor onboarding' })).toBeVisible();
});

test('responsive layouts fit phone, tablet and desktop', async ({ page }) => {
  await mkdir('docs/screens', { recursive: true });
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      '/admin',
      '/patient',
      '/patient/doctors',
      '/doctor/records',
      '/auth/login',
    ]) {
      await page.goto(path);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    await page.goto('/admin');
    await page.screenshot({ path: `docs/screens/web-admin-${width}.png`, fullPage: true });
  }
});

test('core screens and booking dialog meet automated WCAG checks', async ({ page }) => {
  test.setTimeout(180_000);
  for (const path of [
    '/admin',
    '/admin/appointments',
    '/admin/approvals',
    '/admin/doctors',
    '/admin/doctors/d1',
    '/admin/patients',
    '/admin/branches',
    '/admin/specializations',
    '/admin/schedules',
    '/admin/records',
    '/admin/fees',
    '/admin/activity',
    '/admin/notifications',
    '/admin/settings',
    '/patient',
    '/patient/settings',
    '/doctor/records',
    '/doctor/reports',
    '/patient/doctors',
    ...[
      'welcome',
      'login',
      'register',
      'forgot',
      'reset',
      'verify-email',
      'invitation',
      'two-factor',
    ].map((mode) => `/auth/${mode}`),
  ]) {
    await page.goto(path);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
      path,
    ).toEqual([]);
  }
  await page.goto('/patient');
  await page.getByRole('button', { name: 'Book appointment', exact: true }).first().click();
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
});

test('authentication prototypes are reachable and never send requests', async ({ page }) => {
  for (const mode of [
    'welcome',
    'login',
    'register',
    'forgot',
    'reset',
    'verify-email',
    'invitation',
    'two-factor',
  ]) {
    await page.goto(`/auth/${mode}`);
    await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
  }
});
