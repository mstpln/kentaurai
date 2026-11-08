/**
 * Optional account-wide R2 operation observation for the current UTC date.
 * Cloudflare actionType is not a reliable Class A/B invoice mapping here;
 * never classify these rows as billable Class A/B. Those remain separate
 * verified monthly quantities in Cloudflare's billable usage API.
 */
export const R2_DAILY_OPERATIONS_QUERY = `query TravdataR2Today(
  $accountTag: string!,
  $day: Date!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2OperationsAdaptiveGroups(
        limit: 1000,
        filter: { date_geq: $day, date_leq: $day },
        orderBy: [date_DESC]
      ) {
        dimensions { date bucketName actionType }
        sum { requests }
      }
    }
  }
}`;

export async function loadAccountR2DailyOperations(runGraphql, options) {
  const day = new Date(options.date).toISOString().slice(0,10);
  const data = await runGraphql(R2_DAILY_OPERATIONS_QUERY,{
    accountTag:options.accountId,day
  });
  const rows = data?.data?.viewer?.accounts?.[0]?.r2OperationsAdaptiveGroups;
  if (!Array.isArray(rows) || rows.length >= 1000) {
    throw new Error('R2 daily operation analytics incomplete');
  }
  let operations = 0;
  for (const row of rows) {
    const n=row?.sum?.requests;
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('R2 operation quantity unavailable');
    operations+=n;
  }
  if (!Number.isSafeInteger(operations)) throw new Error('R2 operation quantity overflow');
  return {accountWide:true,approximate:true,day,operations,
    source:'cloudflare_r2_operations_adaptive'};
}
