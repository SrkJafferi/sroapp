import { z } from 'zod';
export const emailSchema = z.email('Enter a valid email address.');
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .regex(/[A-Z]/, 'Include an uppercase letter.')
  .regex(/[0-9]/, 'Include a number.');
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter a password.'),
});
// Real account onboarding; authority fields are deliberately absent and stripped.
export const authSignupSchema = loginSchema.extend({
  name: z.string().trim().min(3).max(200),
  password: passwordSchema,
});
export const authPatientProfileSchema = z.object({
  name: z.string().trim().min(3).max(200),
  phone: z.string().regex(/^\+?[\d -]{10,20}$/),
  ageYears: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : Number(value)),
    z.number().int().min(0).max(120),
  ),
  gender: z.string().trim().min(1).max(40),
  address: z.string().trim().max(500).default(''),
});
export const registrationSchema = z.object({
  name: z.string().trim().min(2),
  email: emailSchema,
  phone: z.string().regex(/^\+?[\d\s-]{10,16}$/, 'Enter a valid phone number.'),
  password: passwordSchema,
  consent: z.literal(true, { error: 'Accept the demo terms to continue.' }),
});
export const invitationSchema = z.object({
  name: z.string().trim().min(2),
  email: emailSchema,
  specializationId: z.string().min(1),
  branchId: z.string().min(1),
});
export const bookingSchema = z.object({
  branchId: z.string().min(1),
  doctorId: z.string().min(1),
  patientId: z.string().min(1),
  date: z.iso.date(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  type: z.enum(['physical', 'remote']),
  reason: z.string().trim().min(3).max(1000),
  source: z.enum(['patient', 'walk_in', 'follow_up']).optional(),
});
export const prescriptionItemSchema = z.object({
  medication: z.string().trim().min(1),
  strength: z.string().trim().min(1),
  dosage: z.string().trim().min(1),
  frequency: z.string().trim().min(1),
  duration: z.string().trim().min(1),
  instructions: z.string().trim().min(1),
});
export const branchSchema = z.object({
  name: z.string().trim().min(3),
  address: z.string().trim().min(5),
  phone: z.string().trim().min(10),
  active: z.boolean(),
});
export const documentSchema = z.object({
  name: z.string().min(1),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  size: z
    .number()
    .positive()
    .max(10 * 1024 * 1024, 'Maximum file size is 10 MB.'),
});
export const patientSchema = z.object({
  name: z.string().trim().min(3),
  email: emailSchema,
  phone: z.string().regex(/^\+?[\d\s-]{10,20}$/, 'Enter a valid phone number.'),
  dateOfBirth: z.iso.date(),
  gender: z.string().min(1),
  branchId: z.string().min(1),
});
// Clinical intake is separate from verified portal signup; authority fields are rejected.
export const walkInPatientSchema = z
  .object({
    requestId: z.uuid(),
    branchId: z.uuid(),
    name: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .regex(/^[^\u0000-\u001f\u007f]+$/),
    ageYears: z.number().int().min(0).max(120),
    gender: z.enum(['Female', 'Male', 'Other', 'Prefer not to say']),
    email: z.union([emailSchema, z.literal('')]).default(''),
    phone: z
      .string()
      .trim()
      .max(30)
      .refine(
        (v) =>
          !v ||
          (/^[+0-9 ()-]+$/.test(v) &&
            v.replace(/\D/g, '').length >= 7 &&
            v.replace(/\D/g, '').length <= 20),
        'Enter a valid phone number.',
      )
      .default(''),
    address: z.string().trim().max(500).default(''),
    bloodGroup: z.enum(['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).default(''),
  })
  .strict();
export const leaveSchema = z.object({
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  reason: z.string().trim().min(3),
});
export const clinicTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use a valid 24-hour time (HH:mm).');
export const departmentSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Enter a department name with at least two characters.')
      .max(100),
    description: z.string().trim().max(2000).default(''),
  })
  .strict();

// Decimal text stays exact through JSON and PostgreSQL numeric multiplication.
// The deployed fee command accepts PKR 0–1,000,000 with at most two decimals.
export const consultationFeeSchema = z
  .string()
  .trim()
  .max(16)
  .regex(/^\d+(?:\.\d{1,2})?$/, 'Enter a valid PKR amount with up to two decimal places.')
  .transform((value) => {
    const [whole, fraction = ''] = value.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  })
  .refine(
    (paisa) => Number.isSafeInteger(paisa) && paisa >= 0 && paisa <= 100_000_000,
    'Consultation fee must be between Rs. 0 and Rs. 1,000,000.',
  );
export const paisaToPkr = (paisa: number) =>
  `${Math.floor(paisa / 100)}.${String(paisa % 100).padStart(2, '0')}`;
