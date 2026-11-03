import { notFound } from 'next/navigation';
import { SyntheticSro0009RecoveryValidation } from '@/components/synthetic-sro0009-recovery-validation';
export default function Page() {
  if (process.env.NODE_ENV !== 'development' || process.env.SRO_SYNTHETIC_HANDOVER_TESTS !== '1')
    notFound();
  return <SyntheticSro0009RecoveryValidation />;
}
