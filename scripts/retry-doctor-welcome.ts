// Explicit operator retry for ONE completed invitation. No scanning or arbitrary recipients.
// node --conditions=react-server --import tsx scripts/retry-doctor-welcome.ts <invitation UUID>
import { z } from 'zod';
import { deliverDoctorWelcome } from '../apps/web/lib/auth/doctor-welcome';
process.loadEnvFile('apps/web/.env.local');
const id = z.uuid().parse(process.argv[2]);
process.chdir('apps/web');
try {
  console.log(JSON.stringify({ invitationId: id, delivery: await deliverDoctorWelcome(id) }));
} catch {
  console.error(
    'Welcome retry could not be confirmed. Durable delivery state retained; no secrets logged.',
  );
  process.exitCode = 1;
}
