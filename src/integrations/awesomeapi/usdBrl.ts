/** The latest USD→BRL bid from AwesomeAPI, or null if it can't be had. The token is optional. */
export async function fetchUsdBrl(token: string | null): Promise<number | null> {
  try {
    // The token goes in a header, not the URL, so it stays out of request logs.
    const res = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL", token ? { headers: { "x-api-key": token } } : undefined);
    if (!res.ok) return null;
    const bid = Number((await res.json())?.USDBRL?.bid);
    return bid > 0 ? bid : null;
  } catch {
    return null;
  }
}
