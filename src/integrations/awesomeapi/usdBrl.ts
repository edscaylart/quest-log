/** The latest USD→BRL bid from AwesomeAPI, or null if it can't be had. The token is optional. */
export async function fetchUsdBrl(token: string | null): Promise<number | null> {
  const url = new URL("https://economia.awesomeapi.com.br/json/last/USD-BRL");
  if (token) url.searchParams.set("token", token);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bid = Number((await res.json())?.USDBRL?.bid);
    return bid > 0 ? bid : null;
  } catch {
    return null;
  }
}
