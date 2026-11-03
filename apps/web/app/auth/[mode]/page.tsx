import { pilotExecutionEnabled } from '@/lib/patient-access-pilot-policy';
import { coordinatedPatientAccessRoutesEnabled } from '@/lib/patient-access-coordinated';
import { PatientInitialPassword } from '@/components/patient-initial-password';
import { authenticatedSession } from '@/lib/auth/session';
import { notFound, redirect } from 'next/navigation';
import { AuthScreen } from '@/components/auth-screen';
import { loadIdentity } from '@/lib/auth/session';
import { homeFor } from '@/lib/auth/policy';
import { DoctorOnboarding } from '@/components/doctor-onboarding';
export default async function Page({ params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  if (mode === 'patient-pilot') {
    if (!pilotExecutionEnabled()) notFound();
    return <AuthScreen mode="login" patientIdLogin />;
  }
  if (
    mode === 'change-password' &&
    (pilotExecutionEnabled() || coordinatedPatientAccessRoutesEnabled())
  ) {
    const session = await authenticatedSession();
    if (!session) redirect('/auth/login');
    if (session.needsMfa) redirect('/auth/two-factor');
    if (!session.needsPasswordChange) redirect('/auth/continue');
    return <PatientInitialPassword />;
  }
  if (mode === 'invitation') return <DoctorOnboarding />;
  if (['account-ready', 'complete-profile'].includes(mode)) {
    const identity = await loadIdentity();
    if (!identity) redirect('/auth/login');
    if (mode === 'account-ready' && homeFor(identity) !== '/auth/account-ready')
      redirect('/auth/continue');
  }
  if (
    ![
      'welcome',
      'login',
      'register',
      'forgot',
      'reset',
      'verify-email',
      'invitation',
      'two-factor',
      'complete-profile',
      'account-ready',
      'access-denied',
    ].includes(mode)
  )
    notFound();
  return <AuthScreen mode={mode} />;
}
