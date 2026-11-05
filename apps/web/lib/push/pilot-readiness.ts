import 'server-only';
import type { sessionClient } from '../supabase/server';
import { publicConfig } from '../supabase/server';
import { pilotScope, pilotIdentityMatches } from '../../../../supabase/functions/_shared/push-pilot-policy';
import { z } from 'zod';
const returnedScope = z.object({userId:z.uuid(),organizationId:z.uuid(),installationId:z.uuid(),notificationId:z.uuid(),bindingId:z.uuid(),startsAt:z.iso.datetime(),expiresAt:z.iso.datetime()});
const paused = (reason: string) => ({ready:false as const,reason});
export async function verifyPilotPublishing(client: Awaited<ReturnType<typeof sessionClient>>, identity: {id:string;name:string}, organizationId: string, branchId: string, caps: {pilotEligible:boolean;pilotOwnDevice:boolean;pilotPrepared:boolean;databaseEnabled:boolean;broadcastsEnabled:boolean}) {
  if (process.env.SRO_PUSH_ENABLED !== '1') return paused('Publishing is paused. You can review this notification; no notification will be created.');
  const env = {get:(name:string)=>process.env[name]}, scope = pilotScope(env,Date.now(),true);
  if (!scope || !pilotIdentityMatches(scope,{userId:identity.id,organizationId,role:'admin'}) || !branchId || !caps.databaseEnabled || caps.broadcastsEnabled || !caps.pilotEligible || !caps.pilotOwnDevice || caps.pilotPrepared)
    return paused('The approved Administrator, device, unused message budget and delivery window must be verified before publishing.');
  try {
    const {data,error}=await client.auth.getSession();if(error||!data.session?.access_token)return paused('Please verify your signed-in session again.');
    const config=publicConfig(), target='https://jyigxpjvygvtvcypujel.supabase.co';
    if(new URL(config.url).origin!==target)return paused('The protected push project could not be verified.');
    const response=await fetch(target+'/functions/v1/push-dispatch/readiness?branchId='+encodeURIComponent(branchId),{headers:{apikey:config.key,Authorization:'Bearer '+data.session.access_token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)return paused('The Edge delivery guard is not ready. Review is available; publishing remains paused.');
    const result=await response.json(), parsed=returnedScope.safeParse(result.scope);
    if(result.ready!==true||!parsed.success)return paused('The Edge delivery scope could not be verified.');
    const s=parsed.data;
    if(!pilotScope(env,Date.now(),true)||['userId','organizationId','installationId','notificationId','bindingId'].some(k=>s[k as keyof typeof s]!==scope[k as keyof typeof scope])||Date.parse(s.startsAt)!==scope.startsAt||Date.parse(s.expiresAt)!==scope.expiresAt)
      return paused('Web and Edge delivery scopes do not match. Publishing remains paused.');
    return {ready:true as const,reason:'One approved Administrator installation; one-message budget.',scope:{recipientName:identity.name,recipientId:identity.id,installationId:s.installationId,expiresAt:s.expiresAt}};
  } catch { return paused('The Edge delivery guard could not be checked. Publishing remains paused.'); }
}
