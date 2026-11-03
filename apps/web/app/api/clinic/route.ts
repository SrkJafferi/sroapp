import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  bookingSchema,
  branchSchema,
  prescriptionItemSchema,
  walkInPatientSchema,
  consultationFeeSchema,
  paisaToPkr,
  departmentSchema,
} from '@sro/validation';
import type { Json, MedicalHistory } from '@sro/types';
import { appOrigin } from '@/lib/auth/mail';
import {
  snapshot,
  clinicalContext,
  checkDatabaseError,
  ClinicalError,
  branchInstant,
} from '@/lib/clinical-server';
import { localParts } from '@/lib/clinical-clock';
import { patientWalkInPilotEnabled, pilotBegin, pilotBind } from '@/lib/patient-walkin-pilot';
const roleSchema = z.enum(['admin', 'doctor', 'patient']);
const uuid = z.uuid();
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
function failure(error: unknown) {
  return error instanceof ClinicalError
    ? reply({ error: error.message }, error.status)
    : reply(
        {
          error:
            error instanceof z.ZodError
              ? 'Please complete all required fields correctly.'
              : 'Unable to load clinic records. Please retry.',
        },
        400,
      );
}
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const role = roleSchema.parse(params.get('role'));
    const org = params.get('organizationId') ?? undefined;
    if (params.get('operation') === 'availability') {
      const { client, membership } = await clinicalContext(role, org);
      const branch = uuid.parse(params.get('branchId'));
      if (!membership.branchIds.includes(branch))
        throw new ClinicalError('Branch access denied.', 403);
      const result = await client.rpc('available_appointment_slots', {
        p_branch_id: branch,
        p_doctor_id: uuid.parse(params.get('doctorId')),
        p_date: z.iso.date().parse(params.get('date')),
      });
      checkDatabaseError(result.error);
      const zone = await client.from('branches').select('timezone').eq('id', branch).single();
      checkDatabaseError(zone.error);
      return reply({
        slots: (result.data ?? []).map((s) => ({
          ...s,
          time: localParts(s.starts_at, zone.data!.timezone).time,
        })),
      });
    }
    return reply(await snapshot(role, org));
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('origin') !== appOrigin())
      throw new ClinicalError('Request origin refused.', 403);
    const text = await request.text();
    if (text.length > 80000) throw new ClinicalError('Request too large.', 413);
    const body = z
      .object({
        role: roleSchema,
        organizationId: uuid,
        command: z.string(),
        input: z.record(z.string(), z.unknown()),
      })
      .parse(JSON.parse(text));
    const { client, user, membership } = await clinicalContext(body.role, body.organizationId);
    const input = body.input;
    let result: { data: unknown; error: { code?: string } | null };
    const branchId = () => {
      const b = uuid.parse(input.branchId);
      if (!membership.branchIds.includes(b)) throw new ClinicalError('Branch access denied.', 403);
      return b;
    };
    if (body.command === 'register-walk-in') {
      if (body.role === 'patient')
        throw new ClinicalError('Staff registration is not authorized.', 403);
      const data = walkInPatientSchema.parse(input);
      branchId();
      const { branchId: branch, requestId, ...fields } = data;
      let pilot: Awaited<ReturnType<typeof pilotBegin>> | null = null;
      if (patientWalkInPilotEnabled()) {
        try {
          pilot = await pilotBegin(user.id, requestId, branch, fields);
        } catch {
          throw new ClinicalError('Pilot registration refused.', 403);
        }
      }
      result = await client.rpc('register_walk_in_patient', {
        p_branch_id: branch,
        p_request_id: requestId,
        p_fields: fields,
      });
      if (pilot?.pilot && !result.error) {
        const saved = z
          .object({ id: uuid, patientCode: z.string().regex(/^SRO[0-9]{4,}$/) })
          .safeParse(result.data);
        if (!saved.success)
          throw new ClinicalError(
            'Patient registration could not be confirmed. Retry the same request.',
            503,
          );
        try {
          await pilotBind(pilot.pilotId, user.id, saved.data.id, saved.data.patientCode);
        } catch {
          throw new ClinicalError(
            'Patient is registered; account setup needs review. Do not register again.',
            503,
          );
        }
      }
      if (result.error?.code === 'PGRST202')
        throw new ClinicalError(
          'Walk-in registration is awaiting activation by the clinic administrator.',
          503,
        );
      if (result.error?.code === '54000')
        throw new ClinicalError('Too many registrations. Please try again later.', 429);
      if (result.error?.code === '22023')
        throw new ClinicalError('Check the patient details and try again.', 400);
    } else if (body.command === 'book') {
      const data = bookingSchema.extend({ slotId: uuid }).parse(input);
      branchId();
      result = await client.rpc('book_appointment', {
        p_slot_id: data.slotId,
        p_patient_id: uuid.parse(data.patientId),
        p_reason: data.reason,
        p_type: data.type,
        p_source: data.source ?? 'patient',
      });
    } else if (body.command === 'transition') {
      const data = z
        .object({
          id: uuid,
          status: z.enum([
            'confirmed',
            'rejected',
            'checked_in',
            'in_consultation',
            'no_show',
            'cancellation_requested',
            'cancelled',
          ]),
        })
        .parse(input);
      result = await client.rpc('transition_appointment', {
        p_appointment_id: data.id,
        p_status: data.status,
      });
    } else if (body.command === 'reschedule') {
      const data = z
        .object({ id: uuid, slotId: uuid, reason: z.string().trim().min(3).max(1000) })
        .parse(input);
      result = await client.rpc('request_reschedule', {
        p_appointment_id: data.id,
        p_slot_id: data.slotId,
        p_reason: data.reason,
      });
    } else if (body.command === 'consultation') {
      const data = z
        .object({
          appointmentId: uuid,
          symptoms: z.string().max(8000),
          examination: z.string().max(8000),
          diagnosis: z.string().max(8000),
          plan: z.string().max(8000),
          followUp: z.string().max(4000),
          vitals: z.object({
            bloodPressure: z.string().max(50),
            pulse: z.string().max(50),
            temperature: z.string().max(50),
            oxygen: z.string().max(50),
            weight: z.string().max(50),
            height: z.string().max(50),
          }),
          status: z.enum(['draft', 'signed']),
          items: z.array(prescriptionItemSchema).max(30),
        })
        .parse(input);
      result = await client.rpc('save_encounter', {
        p_appointment_id: data.appointmentId,
        p_notes: {
          symptoms: data.symptoms,
          examination: data.examination,
          diagnosis: data.diagnosis,
          plan: data.plan,
          followUp: data.followUp,
          vitals: data.vitals,
        },
        p_items: data.items,
        p_sign: data.status === 'signed',
      });
    } else if (body.command === 'grant') {
      result = await client.rpc('grant_clinical_access', {
        p_patient_id: uuid.parse(input.patientId),
        p_branch_id: branchId(),
        p_user_id: uuid.parse(input.userId),
        p_reason: z.string().min(3).max(500).parse(input.reason),
        p_can_write: false,
      });
    } else if (body.command === 'leave') {
      const b = branchId();
      const zone = await client.from('branches').select('timezone').eq('id', b).single();
      checkDatabaseError(zone.error);
      const start = z.iso.date().parse(input.startDate);
      const end = z.iso.date().parse(input.endDate);
      if (end < start) throw new ClinicalError('Leave end date must follow its start date.');
      const nextDate = new Date(`${end}T12:00:00Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      result = await client.rpc('add_doctor_leave', {
        p_doctor_id: uuid.parse(input.doctorId),
        p_starts_at: branchInstant(start, '00:00', zone.data!.timezone),
        p_ends_at: branchInstant(nextDate.toISOString().slice(0, 10), '00:00', zone.data!.timezone),
        p_reason: z.string().min(3).max(1000).parse(input.reason),
      });
    } else if (body.command === 'mark-read') {
      const notificationId = z.object({ notificationId: uuid.optional() }).parse(input)
        .notificationId;
      let recipients = client
        .from('notification_recipients')
        .update({ read_at: new Date().toISOString() })
        .eq('organization_id', membership.organizationId)
        .eq('user_id', user.id)
        .is('read_at', null);
      if (notificationId) recipients = recipients.eq('notification_id', notificationId);
      const response = await recipients;
      result = { data: null, error: response.error };
    } else if (body.command === 'history') {
      const h = z
        .object({
          allergies: z.array(z.string().max(300)).max(100),
          conditions: z.array(z.string().max(300)).max(100),
          medications: z.array(z.string().max(300)).max(100),
          surgeries: z.string().max(2000),
          familyHistory: z.string().max(2000),
          socialHistory: z.string().max(2000),
          bloodGroup: z.string().max(5),
          emergencyContact: z.string().max(300),
        })
        .parse(input.history) satisfies MedicalHistory;
      result = await client.rpc('save_patient_history', {
        p_patient_id: uuid.parse(input.patientId),
        p_branch_id: branchId(),
        p_history: h,
      });
    } else if (body.command === 'configure') {
      const data = z
        .object({
          action: z.enum([
            'branch',
            'organization',
            'profile',
            'department',
            'department_update',
            'doctor',
            'assignment',
            'fee',
            'schedule',
            'revoke_invitation',
          ]),
          data: z.record(z.string(), z.unknown()),
        })
        .parse(input);
      if (data.action === 'branch') branchSchema.parse(data.data);
      if (data.action === 'department' || data.action === 'department_update') {
        if (body.role !== 'admin')
          throw new ClinicalError('Only authorized Admins may edit departments.', 403);
        data.data =
          data.action === 'department_update'
            ? departmentSchema.extend({ id: uuid }).parse(data.data)
            : departmentSchema.parse(data.data);
      }
      if (data.action === 'fee') {
        if (body.role !== 'admin')
          throw new ClinicalError('Only authorized Admins may change consultation fees.', 403);
        const fee = z
          .object({ doctorId: uuid, fee: consultationFeeSchema })
          .strict()
          .parse(data.data);
        data.data = { doctorId: fee.doctorId, fee: paisaToPkr(fee.fee) };
      }
      result = await client.rpc('manage_clinic', {
        p_branch_id: branchId(),
        p_action: data.action,
        p_data: data.data as Json,
      });
      if (data.action === 'department_update' && result.error?.code === '22023')
        throw new ClinicalError(
          'Department editing is awaiting activation by the clinic administrator.',
          503,
        );
    } else if (body.command === 'publish') {
      result = await client.rpc('publish_appointment_slots', {
        p_branch_id: branchId(),
        p_doctor_id: uuid.parse(input.doctorId),
        p_from: z.iso.date().parse(input.from),
        p_until: z.iso.date().parse(input.until),
      });
    } else throw new ClinicalError('This action is unavailable.');
    checkDatabaseError(result.error);
    if (body.command === 'book') {
      const saved = await client
        .from('appointments')
        .select('id,status')
        .eq('id', uuid.parse(result.data))
        .single();
      checkDatabaseError(saved.error);
      if (!saved.data)
        throw new ClinicalError(
          'The appointment status could not be confirmed. Check the appointment list before retrying.',
          503,
        );
      return reply({ saved: true, id: saved.data.id, status: saved.data.status });
    }
    if (body.command === 'register-walk-in') {
      const saved = z
        .object({ id: uuid, patientCode: z.string().regex(/^SRO[0-9]{4,}$/) })
        .safeParse(result.data);
      if (!saved.success)
        throw new ClinicalError(
          'Patient registration could not be confirmed. Retry the same request.',
          503,
        );
      return reply({ saved: true, id: saved.data });
    }
    return reply({ saved: true, id: result.data });
  } catch (error) {
    return failure(error);
  }
}
