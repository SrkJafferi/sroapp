import type { Appointment, ClinicState, UserProfile } from '@sro/types';
import { canDiscoverPatient } from '@sro/permissions';

const content = {
  general: ['Better health begins with care.', 'Everyday care. Lifelong wellness.', 'stethoscope'],
  skin: ['Better skin. Healthier lives.', 'Healthy skin. Confident you.', 'sparkles'],
  children: ['Healthier children. Brighter futures.', 'Growing healthy, growing strong.', 'baby'],
  women: ['Supporting women at every stage.', 'Caring for women. Nurturing life.', 'heart'],
  heart: ['Every heartbeat matters.', 'Stronger hearts. Healthier lives.', 'heart'],
  bones: ['Helping you move with confidence.', 'Stronger bones. Better mobility.', 'activity'],
  ent: ['Better hearing. Easier breathing.', 'Care for every sense.', 'ear'],
  metabolic: ['Supporting better metabolic health.', 'Balanced health. Better living.', 'activity'],
  digestive: [
    'Better digestive health starts here.',
    'Comfort through specialist care.',
    'stethoscope',
  ],
  vision: ['Clearer vision. Brighter days.', 'Caring for your vision.', 'eye'],
  dental: ['Healthier smiles start here.', 'Confident smiles. Better health.', 'smile'],
  breathing: ['Helping every breath feel easier.', 'Better breathing. Better living.', 'wind'],
  neutral: [
    'Care that connects. People who matter.',
    'Compassionate care. Connected lives.',
    'heart',
  ],
} as const;
const aliases: Record<string, keyof typeof content> = {};
for (const [key, names] of Object.entries({
  general: ['General Checkup', 'General Medicine', 'General Practice'],
  skin: ['Dermatology', 'Dermatology (Skin Specialist)'],
  children: ['Pediatrics', 'Paediatrics', 'Pediatrics (Child Specialist)'],
  women: ['Gynecology & Obstetrics', 'Gynaecology & Obstetrics'],
  heart: ['Cardiology', 'Cardiology (Heart Specialist)'],
  bones: ['Orthopedics', 'Orthopaedics'],
  ent: ['ENT', 'ENT (Ear, Nose & Throat)'],
  metabolic: ['Diabetes & Endocrinology'],
  digestive: ['Gastroenterology'],
  vision: ['Ophthalmology', 'Ophthalmology (Eye Specialist)'],
  dental: ['Dentistry', 'Dentistry (Dental Care)'],
  breathing: ['Pulmonology', 'Pulmonology (Chest Specialist)'],
}))
  for (const name of names) aliases[name.toLowerCase()] = key as keyof typeof content;
export function specialtyContent(name: string) {
  const key = aliases[name.trim().replace(/\s+/g, ' ').toLowerCase()] ?? 'neutral';
  const [quote, heading, theme] = content[key];
  return { key, quote, heading, theme };
}
export function shiftDay(date: string, days: number) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function statusGroup(a: Appointment) {
  if (['cancelled', 'rejected', 'no_show', 'doctor_unavailable'].includes(a.status))
    return 'Cancelled / unavailable';
  if (a.status === 'completed') return 'Completed';
  if (['in_consultation', 'checked_in'].includes(a.status)) return 'In consultation';
  if (a.source === 'follow_up') return 'Follow-up scheduled';
  return 'Scheduled / awaiting review';
}
export function doctorDashboardData(
  state: ClinicState,
  actor: UserProfile,
  branchId: string,
  today: string,
) {
  const appointments =
    actor.role === 'doctor' && actor.branchIds.includes(branchId)
      ? state.appointments
          .filter((a) => a.doctorId === actor.doctorId && a.branchId === branchId)
          .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
      : [];
  const patients = state.patients.filter(
    (p) =>
      actor.role === 'doctor' &&
      actor.branchIds.includes(branchId) &&
      (p.branchId === branchId || appointments.some((a) => a.patientId === p.id)) &&
      canDiscoverPatient(actor, p.id, state, branchId),
  );
  const encounters = state.consultations.filter(
    (c) =>
      actor.role === 'doctor' &&
      actor.branchIds.includes(branchId) &&
      c.doctorId === actor.doctorId &&
      c.branchId === branchId &&
      c.status === 'signed',
  );
  const followUps = encounters.filter(
    (c) =>
      Boolean(c.followUp.trim()) &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(c.followUp) || c.followUp <= today) &&
      !appointments.some(
        (a) =>
          a.patientId === c.patientId &&
          (a.date > c.date ||
            (a.source === 'follow_up' && a.date === c.date && a.id !== c.appointmentId)) &&
          !['cancelled', 'rejected', 'no_show', 'doctor_unavailable'].includes(a.status),
      ) &&
      !encounters.some(
        (next) =>
          next.patientId === c.patientId &&
          next.date >= c.date &&
          next.id !== c.id &&
          (next.recordedAt ?? next.date) > (c.recordedAt ?? c.date),
      ),
  );
  return {
    appointments,
    patients,
    encounters,
    today: appointments.filter((a) => a.date === today),
    followUps: new Set(followUps.map((c) => c.patientId)).size,
  };
}
