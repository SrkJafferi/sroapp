import { useState } from 'react';
import { Share, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { clinic } from '@sro/data-access';
import { age, displayDate } from '@sro/clinic-core';
import { canViewPatient } from '@sro/permissions';
import { useClinic } from './context';
import { Avatar, Btn, Card, Empty, go, Item, Page, Row, Select, Txt } from './ui';
export function Records({ kind = 'records' }: { kind?: string }) {
  const { patientId } = useLocalSearchParams<{ patientId?: string }>();
  const { state, actor, role, act } = useClinic();
  const visible = state.patients.filter((p) => canViewPatient(actor, p.id, state));
  const [selection, setSelection] = useState(patientId ?? actor.patientId ?? visible[0]?.id ?? '');
  const [tab, setTab] = useState(
    kind === 'prescriptions'
      ? 'Prescriptions'
      : kind === 'reports'
        ? 'Reports & documents'
        : 'Consultations',
  );
  const [docKind, setDocKind] = useState('report');
  const [expanded, setExpanded] = useState<string | null>(null);
  const p = visible.find((p) => p.id === selection);
  if (!p)
    return (
      <Page title="Medical records">
        <Empty
          title="Record access unavailable"
          text="Only your own or assigned/authorized records are available."
        />
      </Page>
    );
  const consultations = state.consultations.filter(
    (c) => c.patientId === p.id && (role !== 'patient' || c.status === 'signed'),
  );
  const prescriptions = state.prescriptions.filter((r) => r.patientId === p.id);
  const documents = state.documents.filter((d) => d.patientId === p.id);
  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: false,
    });
    if (result.canceled) return;
    const file = result.assets[0];
    act(
      () =>
        clinic.addDocument(actor, {
          patientId: p.id,
          doctorId: actor.doctorId!,
          name: file.name,
          size: file.size ?? 0,
          mimeType: file.mimeType ?? '',
          kind: docKind as 'report' | 'handwritten',
        }),
      'Document metadata added. No file was read, uploaded or stored by the demo.',
    );
  };
  return (
    <Page
      title={
        kind === 'prescriptions'
          ? 'Prescriptions'
          : kind === 'reports'
            ? 'Medical reports'
            : 'Medical records'
      }
      subtitle={
        role === 'patient'
          ? 'Your health story, organized.'
          : 'Assigned and authorized patient records.'
      }
      back={kind !== 'records' || !!patientId}
    >
      {role !== 'patient' && (
        <Select
          label="Patient record"
          value={selection}
          onChange={setSelection}
          options={visible.map((p) => ({
            value: p.id,
            label: `${p.name} · ${p.id.toUpperCase()}`,
          }))}
        />
      )}
      <Card>
        <Row>
          <Avatar initials={p.initials} color="blue" large />
          <View style={{ flex: 1 }}>
            <Txt bold size={19}>
              {p.name}
            </Txt>
            <Txt muted size={12}>
              {age(p.dateOfBirth)} years · {p.gender} · {p.history.bloodGroup}
            </Txt>
            <Txt muted size={10}>
              {p.id.toUpperCase()} · fictional patient
            </Txt>
          </View>
        </Row>
        <Txt bold size={12}>
          Allergies: {p.history.allergies.join(', ') || 'None reported in demo'}
        </Txt>
        <Txt muted size={12}>
          Conditions: {p.history.conditions.join(', ') || 'None reported in demo'}
        </Txt>
        <Txt muted size={11}>
          Medicines: {p.history.medications.join(', ') || 'None reported in demo'}
        </Txt>
        {role === 'admin' && (
          <Btn
            outline
            title="Add authorized clinician"
            onPress={() => go('form', { kind: 'grant', patientId: p.id })}
          />
        )}
      </Card>
      {role === 'doctor' && (
        <Btn
          outline
          title="Edit structured medical history"
          onPress={() => go('form', { kind: 'history', patientId: p.id })}
        />
      )}
      <Select
        label="Record section"
        value={tab}
        onChange={setTab}
        options={['Consultations', 'Medical history', 'Prescriptions', 'Reports & documents'].map(
          (t) => ({ value: t, label: t }),
        )}
      />
      {tab === 'Medical history' && (
        <Card title="Baseline medical history">
          {[
            ['Date of birth', displayDate(p.dateOfBirth)],
            ['Phone', p.phone],
            ['Email', p.email],
            ['Emergency contact', p.history.emergencyContact],
            ['Surgical history', p.history.surgeries],
            ['Family history', p.history.familyHistory],
            ['Social history', p.history.socialHistory],
            [
              'Additional authorized clinicians',
              state.grants
                .filter((g) => g.patientId === p.id)
                .map((g) => state.profiles.find((u) => u.id === g.userId)?.name)
                .join(', ') || 'Assigned care team only',
            ],
          ].map(([key, value]) => (
            <View key={key} style={{ gap: 5 }}>
              <Txt bold size={12}>
                {key}
              </Txt>
              <Txt muted size={12}>
                {value}
              </Txt>
            </View>
          ))}
        </Card>
      )}
      {tab === 'Consultations' && (
        <>
          {consultations.map((c) => (
            <Card key={c.id} title={displayDate(c.date)}>
              <Txt bold>{state.doctors.find((d) => d.id === c.doctorId)?.name}</Txt>
              <Txt muted size={11}>
                {c.status === 'signed' ? 'Signed consultation' : 'Draft note'}
              </Txt>
              <Txt size={13}>{c.symptoms}</Txt>
              {Object.entries(c.vitals)
                .filter(([, v]) => v)
                .map(([key, value]) => (
                  <Txt muted size={12} key={key}>
                    {
                      (
                        {
                          bloodPressure: 'BP (mmHg)',
                          pulse: 'Pulse (bpm)',
                          temperature: 'Temperature (°C)',
                          oxygen: 'SpO₂ (%)',
                          weight: 'Weight (kg)',
                          height: 'Height (cm)',
                        } as Record<string, string>
                      )[key]
                    }
                    : {value}
                  </Txt>
                ))}
              {[
                ['Examination', c.examination],
                ['Diagnosis', c.diagnosis],
                ['Treatment plan', c.plan],
                ['Follow-up', c.followUp],
              ].map(([label, text]) => (
                <View key={label} style={{ gap: 5 }}>
                  <Txt bold size={12}>
                    {label}
                  </Txt>
                  <Txt muted size={12}>
                    {text || 'Not recorded'}
                  </Txt>
                </View>
              ))}
              {role !== 'patient' && (
                <Btn
                  outline
                  title="Schedule follow-up"
                  onPress={() => go('book', { patientId: p.id, doctorId: c.doctorId })}
                />
              )}
            </Card>
          ))}
          {!consultations.length && (
            <Empty
              title="No consultations yet"
              text="Clinical notes will appear after a consultation is saved."
            />
          )}
        </>
      )}
      {tab === 'Prescriptions' && (
        <>
          {prescriptions.map((r) => (
            <Card key={r.id} title="Digital prescription">
              <Txt muted size={12}>
                {state.doctors.find((d) => d.id === r.doctorId)?.name} · {displayDate(r.date)}
              </Txt>
              {r.items.map((item, i) => (
                <View
                  key={i}
                  style={{
                    gap: 6,
                    paddingVertical: 12,
                    borderTopWidth: 1,
                    borderTopColor: '#e9eaf2',
                  }}
                >
                  <Txt bold size={14}>
                    {item.medication} · {item.strength}
                  </Txt>
                  <Txt size={12}>
                    {item.dosage} · {item.frequency} · {item.duration}
                  </Txt>
                  <Txt muted size={12}>
                    {item.instructions}
                  </Txt>
                </View>
              ))}
              <Txt muted size={12}>
                {r.instructions}
              </Txt>
              <Txt muted size={10}>
                Fictional prescription. Not valid for dispensing or treatment.
              </Txt>
              <Btn
                outline
                title="Share demo prescription text"
                onPress={() => {
                  void Share.share({
                    message: `SRO CLINIC — FICTIONAL DEMO ONLY\n${p.name} · ${displayDate(r.date)}\n${r.items.map((x) => `${x.medication} ${x.strength} · ${x.dosage} · ${x.frequency} · ${x.duration}\n${x.instructions}`).join('\n')}\n${r.instructions}\nNot valid for dispensing or treatment.`,
                  });
                }}
              />
            </Card>
          ))}
          {!prescriptions.length && <Empty title="No prescriptions yet" />}
        </>
      )}
      {tab === 'Reports & documents' && (
        <>
          {role === 'doctor' && (
            <Card title="Add medical document">
              <Select
                label="Document type"
                value={docKind}
                onChange={setDocKind}
                options={[
                  { value: 'report', label: 'Medical report' },
                  { value: 'handwritten', label: 'Handwritten prescription' },
                ]}
              />
              <Txt muted size={11}>
                PDF, PNG, JPEG · up to 10 MB · metadata only. File contents are not stored.
              </Txt>
              <Btn
                outline
                title="Choose demo document"
                onPress={() => {
                  void pickDocument();
                }}
              />
            </Card>
          )}
          {documents.map((d) => (
            <Card key={d.id}>
              <Item
                title={d.name}
                subtitle={`${displayDate(d.date)} · ${Math.round(d.size / 1000)} KB`}
                onPress={() => setExpanded(expanded === d.id ? null : d.id)}
              />
              {expanded === d.id && (
                <>
                  <Txt muted size={12}>
                    {d.kind === 'handwritten' ? 'Handwritten prescription' : 'Medical report'} ·{' '}
                    {d.mimeType}
                  </Txt>
                  <Txt muted size={11}>
                    This is metadata only. No medical file is stored, so there is no file to
                    download in Phase 1.
                  </Txt>
                </>
              )}
            </Card>
          ))}
          {!documents.length && <Empty title="No documents yet" />}
        </>
      )}
    </Page>
  );
}
