import { privatePushPayload } from './contracts';
export type PushJob = {
  id: string;
  claim: string;
  token: string;
  ticket: string | null;
  notificationId: string;
  bindingId: string;
  category: string;
};
export type PushOutcome = {
  id: string;
  claim: string;
  status: 'ticket' | 'accepted' | 'failed' | 'uncertain';
  ticket?: string;
  error?: string;
};

// No message content or user identifiers go to Expo. An ambiguous HTTP outcome
// is NOT automatically retried, preventing silent duplicate notifications.
export async function deliverPushBatch(
  jobs: PushJob[],
  request: typeof fetch = fetch,
  accessToken?: string,
): Promise<PushOutcome[]> {
  if (!jobs.length) return [];
  const receipts = !!jobs[0].ticket;
  if (jobs.some((j) => !!j.ticket !== receipts) || jobs.length > 50)
    throw Error('Invalid push batch');
  const base = (j: PushJob) => ({ id: j.id, claim: j.claim });
  let response: Response;
  try {
    response = await request(
      `https://exp.host/--/api/v2/push/${receipts ? 'getReceipts' : 'send'}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(
          receipts ? { ids: jobs.map((j) => j.ticket) } : jobs.map(privatePushPayload),
        ),
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch {
    return jobs.map((j) => ({
      ...base(j),
      status: receipts ? 'failed' : 'uncertain',
      error: receipts ? 'retry' : 'transport_unknown',
    }));
  }
  if (!response.ok)
    return jobs.map((j) => ({
      ...base(j),
      status: 'failed',
      error: response.status === 429 || response.status >= 500 ? 'retry' : 'expo_http_rejected',
    }));
  let result: { data?: unknown };
  try {
    result = await response.json();
  } catch {
    return jobs.map((j) => ({
      ...base(j),
      status: receipts ? 'failed' : 'uncertain',
      error: receipts ? 'retry' : 'invalid_expo_response',
    }));
  }
  return jobs.map((j, i) => {
    const entry = (
      receipts
        ? (result.data as Record<string, unknown>)?.[j.ticket!]
        : Array.isArray(result.data)
          ? result.data[i]
          : undefined
    ) as { status?: string; id?: string; details?: { error?: string } } | undefined;
    if (entry?.status === 'ok' && (receipts || typeof entry.id === 'string'))
      return {
        ...base(j),
        status: receipts ? 'accepted' : 'ticket',
        ...(!receipts ? { ticket: entry!.id } : {}),
      };
    const code = entry?.details?.error;
    return {
      ...base(j),
      status: !entry && !receipts ? 'uncertain' : 'failed',
      error:
        code === 'DeviceNotRegistered'
          ? 'DeviceNotRegistered'
          : code === 'MessageRateExceeded' || (!entry && receipts)
            ? 'retry'
            : !entry
              ? 'invalid_expo_response'
              : 'expo_rejected',
    };
  });
}
