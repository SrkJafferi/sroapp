import { notFound } from 'next/navigation';
import { SyntheticHandoverValidation } from '@/components/synthetic-handover-validation';
export default function Page() {
  if (process.env.NODE_ENV !== 'development' || process.env.SRO_SYNTHETIC_HANDOVER_TESTS !== '1')
    notFound();
  return <SyntheticHandoverValidation />;
}
