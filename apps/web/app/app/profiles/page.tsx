import type { SearchProfile } from '@jobradar/shared';

import { ProfilesManager } from '@/components/profiles-manager';
import { serverApiGet } from '@/lib/server-api';

export default async function ProfilesPage() {
  const profiles = await serverApiGet<SearchProfile[]>('/profiles');
  return <ProfilesManager initial={profiles} />;
}
