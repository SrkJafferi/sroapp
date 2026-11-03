import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test('native components support all three roles and the patient booking flow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Patient Book visits and manage your health' }).click();
  await expect(page.getByRole('heading', { name: 'Good morning, Ali', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Book appointment', exact: true }).click();
  await page.getByRole('button', { name: /Dr. Sara Khan/ }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: '9:30 AM', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Reason for visit', exact: true })
    .fill('Fictional mobile check-up');
  await page.getByRole('button', { name: 'Submit appointment request' }).click();
  await expect(page.getByText('Your request is in good hands.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.getByRole('button', { name: 'View appointments', exact: true }).click();
  await expect(page.getByText('Your appointments', { exact: true })).toBeVisible();
  await mkdir('docs/screens', { recursive: true });
  await page.screenshot({ path: 'docs/screens/native-patient-390.png', fullPage: true });
  await page.getByRole('tab', { name: /Workspace/ }).click();
  await page.getByRole('button', { name: 'Demo role: Patient' }).click();
  await page.getByRole('button', { name: 'Admin', exact: true }).click();
  await page.getByRole('tab', { name: /Home/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back, Amina', exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: /Workspace/ }).click();
  await page.getByRole('button', { name: 'Pending approvals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pending approvals', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await page.getByRole('button', { name: 'Demo role: Admin' }).click();
  await page.getByRole('button', { name: 'Doctor', exact: true }).click();
  await page.getByRole('tab', { name: /Home/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Good morning, Dr. Sara', exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: /Records/ }).click();
  await expect(page.getByRole('heading', { name: 'Medical records', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
