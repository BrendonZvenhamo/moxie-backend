import { UserService } from '../core/services/user';
import { MatchmakingService } from '../core/services/matchmaker';
import { runMaintenanceOnce } from '../core/services/maintenance';
import { runMigrations } from '../infrastructure/database/migrations';

async function main(): Promise<void> {
  await runMigrations();
  const users = new UserService();
  const matchmaker = new MatchmakingService(users);

  const result = await runMaintenanceOnce(users, matchmaker);

  console.log(JSON.stringify(result));
  process.exit(0);
}

main().catch(error => { console.error('MAINTENANCE WORKER FATAL:', error); process.exit(1); });
