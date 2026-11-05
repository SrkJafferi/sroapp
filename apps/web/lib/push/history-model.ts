export type BroadcastHistory = {
  id: string;
  title: string;
  message: string;
  created_at: string;
  recipient_count: number;
  delivery: Record<string, number> | null;
  read_count?: number;
};
export function deliveryCounts(row: BroadcastHistory) {
  const n = (key: string) => Math.max(0, row.delivery?.[key] ?? 0);
  return {
    pending: n('queued') + n('sending') + n('ticket'),
    accepted: n('provider_accepted'),
    failed: n('failed'),
    uncertain: n('uncertain'),
    cancelled: n('cancelled'),
    read: row.read_count ?? null,
  };
}
export function notificationTotals(rows: BroadcastHistory[]) {
  return rows.reduce(
    (v, row) => {
      const d = deliveryCounts(row);
      return {
        recipients: v.recipients + row.recipient_count,
        pending: v.pending + d.pending,
        accepted: v.accepted + d.accepted,
        failed: v.failed + d.failed,
      };
    },
    { recipients: 0, pending: 0, accepted: 0, failed: 0 },
  );
}
