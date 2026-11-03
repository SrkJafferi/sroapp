export type PublicBranch = {
  id: string;
  name: string;
  location: string;
  imageUrl?: string;
  hours?: string;
  openNow?: boolean;
  statusValidUntil?: string;
  latitude?: number;
  longitude?: number;
  popularityRank?: number;
};
export type PublicDoctor = {
  id: string;
  name: string;
  specialization: string;
  branchIds: string[];
  imageUrl?: string;
};
export type PublicDepartment = {
  id: string;
  name: string;
  description: string;
  branchIds: string[];
  doctorIds: string[];
};
export type DiscoveryFeed = {
  version: 1;
  branches: PublicBranch[];
  doctors: PublicDoctor[];
  departments: PublicDepartment[];
};
const text = (v: unknown, max = 200) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max)
    throw Error('Invalid public information.');
  return v;
};
const optional = (v: unknown, max = 200) => (v == null ? undefined : text(v, max));
const list = (v: unknown): Record<string, unknown>[] => {
  if (
    !Array.isArray(v) ||
    v.length > 1000 ||
    v.some((x) => !x || typeof x !== 'object' || Array.isArray(x))
  )
    throw Error('Invalid discovery feed.');
  return v;
};
const ids = (v: unknown) => {
  if (!Array.isArray(v) || v.length > 200) throw Error('Invalid relationships.');
  return v.map((x) => text(x, 100));
};
// Only explicitly public projection fields survive. Never query private clinic snapshots.
export function parseDiscoveryFeed(value: unknown): DiscoveryFeed {
  if (!value || typeof value !== 'object' || (value as { version?: number }).version !== 1)
    throw Error('Unsupported public feed.');
  const v = value as Record<string, unknown>;
  const image = (s: unknown) => {
    if (s == null) return undefined;
    const u = new URL(text(s, 1000));
    if (u.origin !== 'https://app.sropk.org' || u.protocol !== 'https:' || u.username || u.password)
      throw Error('Unapproved public image.');
    return u.href;
  };
  return {
    version: 1,
    branches: list(v.branches).map((b) => ({
      id: text(b.id, 100),
      name: text(b.name),
      location: text(b.location),
      imageUrl: image(b.imageUrl),
      hours: b.hoursVerified === true ? optional(b.hours) : undefined,
      openNow: typeof b.openNow === 'boolean' ? b.openNow : undefined,
      statusValidUntil: optional(b.statusValidUntil, 50),
      latitude:
        typeof b.latitude === 'number' && Math.abs(b.latitude) <= 90 ? b.latitude : undefined,
      longitude:
        typeof b.longitude === 'number' && Math.abs(b.longitude) <= 180 ? b.longitude : undefined,
      popularityRank:
        typeof b.popularityRank === 'number' &&
        Number.isInteger(b.popularityRank) &&
        b.popularityRank > 0
          ? b.popularityRank
          : undefined,
    })),
    doctors: list(v.doctors).map((d) => ({
      id: text(d.id, 100),
      name: text(d.name),
      specialization: text(d.specialization),
      branchIds: ids(d.branchIds),
      imageUrl: image(d.imageUrl),
    })),
    departments: list(v.departments).map((d) => ({
      id: text(d.id, 100),
      name: text(d.name),
      description: text(d.description, 1000),
      branchIds: ids(d.branchIds),
      doctorIds: ids(d.doctorIds),
    })),
  };
}
export function reliableOpenStatus(branch: PublicBranch, now = Date.now()) {
  const expiry = Date.parse(branch.statusValidUntil ?? '');
  return typeof branch.openNow === 'boolean' && expiry > now && expiry - now <= 86400000
    ? branch.openNow
    : undefined;
}
export function searchDiscovery(feed: DiscoveryFeed, query: string): DiscoveryFeed {
  const q = query.trim().toLocaleLowerCase();
  return {
    version: 1,
    branches: feed.branches.filter((b) =>
      `${b.name} ${b.location}`.toLocaleLowerCase().includes(q),
    ),
    doctors: feed.doctors.filter((d) =>
      `${d.name} ${d.specialization} ${feed.branches
        .filter((b) => d.branchIds.includes(b.id))
        .map((b) => b.name)
        .join(' ')}`
        .toLocaleLowerCase()
        .includes(q),
    ),
    departments: feed.departments.filter((d) =>
      `${d.name} ${d.description}`.toLocaleLowerCase().includes(q),
    ),
  };
}
